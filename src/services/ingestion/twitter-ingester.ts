/**
 * Twitter/X Ingester
 *
 * Uses the Twitter v2 API (Bearer Token, Basic tier).
 * Two modes:
 *   1. Search-based: recent tweets mentioning tracked project names
 *   2. Timeline-based: tweets from official @handles
 *
 * Falls back gracefully if no bearer token is configured.
 */

import fetch from 'node-fetch';
import { supabase } from '../../db/client';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { contentHash } from '../../utils/hash';

const TWITTER_BASE = 'https://api.twitter.com/2';

interface Tweet {
  id:         string;
  text:       string;
  created_at?: string;
  author_id?: string;
  entities?: {
    urls?: Array<{ expanded_url: string }>;
  };
}

interface TwitterResponse {
  data?:  Tweet[];
  meta?:  { newest_id: string; oldest_id: string; result_count: number };
  errors?: Array<{ message: string }>;
}

function headers(): Record<string, string> {
  return {
    'Authorization': `Bearer ${config.apis.twitterBearerToken}`,
    'Content-Type':  'application/json',
  };
}

// ── Timeline ingestion (official @handle) ─────────────────────

export async function ingestTwitterChannels(): Promise<number> {
  if (!config.apis.twitterBearerToken) {
    logger.warn('TWITTER_BEARER_TOKEN not set — skipping Twitter ingestion');
    return 0;
  }

  const { data: channels, error } = await supabase
    .from('monitoring_channels')
    .select('id, project_id, channel_identifier, projects(name)')
    .eq('channel_type', 'twitter')
    .eq('is_active', true)
    .lte('consecutive_errors', 5);

  if (error || !channels) return 0;

  let total = 0;
  for (const ch of channels) {
    const handle = ch.channel_identifier.replace(/^@/, '');
    const count  = await fetchUserTimeline(
      handle, ch.project_id, ch.id,
      (ch as any).projects?.name ?? handle,
    );
    total += count;

    await supabase.from('monitoring_channels').update({
      last_checked_at: new Date().toISOString(),
      ...(count >= 0
        ? { last_successful_fetch_at: new Date().toISOString(), consecutive_errors: 0 }
        : { consecutive_errors: (ch as any).consecutive_errors + 1 }),
    }).eq('id', ch.id);

    await sleep(1500); // Twitter API rate limits: 300 req/15min Basic
  }

  return total;
}

// ── Search-based ingestion (catches news/incidents) ───────────

export async function ingestTwitterSearch(): Promise<number> {
  if (!config.apis.twitterBearerToken) return 0;

  // Fetch top project names to build search queries
  const { data: projects } = await supabase
    .from('projects')
    .select('name, slug')
    .eq('is_active', true)
    .gte('significance_score', 60)
    .order('significance_score', { ascending: false })
    .limit(50);

  if (!projects?.length) return 0;

  let total = 0;
  // Process in groups of 5 (each search query can include multiple terms)
  for (let i = 0; i < projects.length; i += 5) {
    const group = projects.slice(i, i + 5);
    const query = group.map(p => `"${p.name}"`).join(' OR ')
      + ' (hack OR exploit OR breach OR upgrade OR launch OR airdrop OR delist OR rug)'
      + ' -is:retweet lang:en';

    const count = await searchTweets(query, null, null);
    total += count;
    await sleep(2000);
  }

  return total;
}

// ── Core API calls ────────────────────────────────────────────

async function fetchUserTimeline(
  handle:    string,
  projectId: string,
  channelId: string,
  name:      string,
): Promise<number> {
  // First: resolve handle → user_id
  let userId: string;
  try {
    const res = await fetch(
      `${TWITTER_BASE}/users/by/username/${handle}?user.fields=id`,
      { headers: headers() }
    );
    const data = await res.json() as { data?: { id: string } };
    if (!data.data?.id) return 0;
    userId = data.data.id;
  } catch {
    return -1;
  }

  try {
    const url = `${TWITTER_BASE}/users/${userId}/tweets`
      + `?max_results=20&tweet.fields=created_at,entities&expansions=author_id`;
    const res  = await fetch(url, { headers: headers() });
    const data = await res.json() as TwitterResponse;

    if (!data.data?.length) return 0;

    return await saveTweets(data.data, projectId, channelId, handle);
  } catch {
    return -1;
  }
}

async function searchTweets(
  query:     string,
  projectId: string | null,
  channelId: string | null,
): Promise<number> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `${TWITTER_BASE}/tweets/search/recent`
      + `?query=${encoded}&max_results=20&tweet.fields=created_at,entities&expansions=author_id`;
    const res  = await fetch(url, { headers: headers() });
    const data = await res.json() as TwitterResponse;

    if (!data.data?.length) return 0;
    return await saveTweets(data.data, projectId, channelId, 'search');
  } catch {
    return 0;
  }
}

async function saveTweets(
  tweets:    Tweet[],
  projectId: string | null,
  channelId: string | null,
  source:    string,
): Promise<number> {
  const rows: Record<string, unknown>[] = [];

  for (const tweet of tweets) {
    const url  = `https://twitter.com/i/web/status/${tweet.id}`;
    const hash = contentHash(url, tweet.text);

    rows.push({
      project_id:          projectId,
      channel_id:          channelId,
      source_type:         'tweet',
      source_platform:     'Twitter/X',
      source_url:          url,
      content_published_at: tweet.created_at ?? null,
      raw_text:            tweet.text.slice(0, 4000),
      raw_metadata: {
        tweet_id:   tweet.id,
        author_id:  tweet.author_id,
        handle:     source,
        urls:       tweet.entities?.urls?.map(u => u.expanded_url) ?? [],
      },
      content_hash:      hash,
      processing_status: 'pending',
    });
  }

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('raw_content')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true });

  if (error) {
    logger.warn('Twitter insert error', error.message);
    return 0;
  }

  return rows.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
