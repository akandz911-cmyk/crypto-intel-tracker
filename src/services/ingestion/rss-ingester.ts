/**
 * RSS Ingester
 * Fetches RSS/Atom feeds for project blogs and global crypto news outlets.
 * All items are written to raw_content with a content_hash for dedup.
 */

import Parser from 'rss-parser';
import { supabase } from '../../db/client';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { contentHash } from '../../utils/hash';

const parser = new Parser({
  timeout: config.ingestion.fetchTimeoutMs,
  headers: {
    'User-Agent': 'CryptoIntelTracker/1.0 (https://github.com/your-org/crypto-intel)',
    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
  },
});

// ── Per-project blog ingestion ────────────────────────────────

export async function ingestProjectRssFeeds(): Promise<number> {
  const { data: channels, error } = await supabase
    .from('monitoring_channels')
    .select('id, project_id, channel_url, channel_identifier, projects(name)')
    .in('channel_type', ['rss_blog', 'substack', 'medium'])
    .eq('is_active', true)
    .lte('consecutive_errors', 5);

  if (error || !channels) {
    logger.warn('Failed to fetch RSS channels', error);
    return 0;
  }

  let total = 0;
  for (const ch of channels) {
    const count = await fetchAndStoreFeed(
      ch.channel_url,
      ch.id,
      ch.project_id,
      (ch as any).projects?.name ?? 'unknown',
      ch.channel_url,
    );
    total += count;

    // Update channel health
    await supabase.from('monitoring_channels').update({
      last_checked_at: new Date().toISOString(),
      ...(count > 0 ? {
        last_successful_fetch_at: new Date().toISOString(),
        consecutive_errors: 0,
        total_items_fetched: count,
      } : {
        consecutive_errors: (ch as any).consecutive_errors + 1,
      }),
    }).eq('id', ch.id);
  }

  return total;
}

// ── Global crypto news ingestion ─────────────────────────────

export async function ingestNewsFeeds(): Promise<number> {
  let total = 0;
  for (const feed of config.newsFeeds) {
    const count = await fetchAndStoreFeed(
      feed.url,
      null,   // no channel_id (global news, not project-specific)
      null,   // no project_id yet — AI will match to projects later
      feed.name,
      feed.url,
    );
    total += count;
    await sleep(200);
  }
  return total;
}

// ── Core fetch + store ────────────────────────────────────────

async function fetchAndStoreFeed(
  feedUrl:    string,
  channelId:  string | null,
  projectId:  string | null,
  sourceName: string,
  baseUrl:    string,
): Promise<number> {
  let feed: Awaited<ReturnType<typeof parser.parseURL>>;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err) {
    logger.warn(`RSS fetch failed: ${feedUrl}`, String(err).slice(0, 120));
    return 0;
  }

  const rows: Record<string, unknown>[] = [];

  for (const item of feed.items ?? []) {
    const text = [
      item.title ?? '',
      item.contentSnippet ?? item.content ?? item.summary ?? '',
    ].filter(Boolean).join('\n\n');

    if (!text.trim() || !item.link) continue;

    const hash = contentHash(item.link, text);

    rows.push({
      project_id:          projectId,
      channel_id:          channelId,
      source_type:         channelId ? 'rss_blog' : 'news_article',
      source_platform:     sourceName,
      source_url:          item.link,
      content_published_at: item.isoDate ?? item.pubDate ?? null,
      raw_text:            text.slice(0, 8000),
      raw_metadata:        {
        title:    item.title,
        author:   item.creator ?? item.author ?? null,
        feed_url: feedUrl,
      },
      content_hash:        hash,
      processing_status:   'pending',
    });
  }

  if (rows.length === 0) return 0;

  // Insert with ON CONFLICT DO NOTHING — the unique content_hash handles dedup
  const { error } = await supabase
    .from('raw_content')
    .insert(rows, { count: 'exact' })
    .on('conflict', 'content_hash').ignore();  // pseudo: handled below

  if (error && !error.message.includes('duplicate')) {
    // Re-insert ignoring duplicates manually
    const { error: e2 } = await supabase
      .from('raw_content')
      .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true });
    if (e2) {
      logger.warn(`RSS insert error for ${sourceName}`, e2.message);
      return 0;
    }
  }

  logger.debug(`RSS ingested ${rows.length} items from ${sourceName}`);
  return rows.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
