/**
 * GitHub Ingester
 * Monitors GitHub releases, tags, and security advisories for every
 * project that has a GitHub channel configured.
 */

import { Octokit } from '@octokit/rest';
import { supabase } from '../../db/client';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { contentHash } from '../../utils/hash';

const octokit = new Octokit({
  auth: config.apis.githubToken || undefined,
  request: { timeout: config.ingestion.fetchTimeoutMs },
});

// ── Main export ───────────────────────────────────────────────

export async function ingestGitHubChannels(): Promise<number> {
  const { data: channels, error } = await supabase
    .from('monitoring_channels')
    .select('id, project_id, channel_identifier, channel_url, projects(name)')
    .eq('channel_type', 'github')
    .eq('is_active', true)
    .lte('consecutive_errors', 5);

  if (error || !channels) {
    logger.warn('Failed to fetch GitHub channels', error);
    return 0;
  }

  let total = 0;
  for (const ch of channels) {
    const org   = ch.channel_identifier.replace(/^@/, '');
    const count = await ingestOrgReleases(
      org,
      ch.project_id,
      ch.id,
      (ch as any).projects?.name ?? org,
    );
    total += count;

    await supabase.from('monitoring_channels').update({
      last_checked_at: new Date().toISOString(),
      ...(count >= 0
        ? { last_successful_fetch_at: new Date().toISOString(), consecutive_errors: 0 }
        : { consecutive_errors: (ch as any).consecutive_errors + 1 }),
    }).eq('id', ch.id);

    await sleep(1000); // respect GitHub rate limits (60 req/hr unauthenticated, 5000 authenticated)
  }

  return total;
}

// ── Per-org ingestion ─────────────────────────────────────────

async function ingestOrgReleases(
  org:       string,
  projectId: string,
  channelId: string,
  name:      string,
): Promise<number> {
  let count = 0;
  try {
    // Get repos for the org (most starred first)
    const { data: repos } = await octokit.repos.listForOrg({
      org,
      sort: 'pushed',
      per_page: 5,
    });

    for (const repo of repos) {
      // Releases
      const relCount = await ingestRepoReleases(repo.full_name, projectId, channelId, name);
      count += relCount;

      // Security advisories (high-signal for unplanned events)
      const advCount = await ingestSecurityAdvisories(repo.full_name, projectId, channelId, name);
      count += advCount;
    }
  } catch (err) {
    logger.warn(`GitHub org fetch failed: ${org}`, String(err).slice(0, 120));
    return -1;
  }
  return count;
}

async function ingestRepoReleases(
  fullName:  string,
  projectId: string,
  channelId: string,
  name:      string,
): Promise<number> {
  try {
    const [owner, repo] = fullName.split('/');
    const { data: releases } = await octokit.repos.listReleases({
      owner, repo, per_page: 10,
    });

    const rows: Record<string, unknown>[] = [];
    for (const rel of releases) {
      if (!rel.body && !rel.name) continue;
      const text = [rel.name, rel.body].filter(Boolean).join('\n\n');
      const url  = rel.html_url;
      const hash = contentHash(url, text);

      rows.push({
        project_id:          projectId,
        channel_id:          channelId,
        source_type:         'github_release',
        source_platform:     'GitHub',
        source_url:          url,
        content_published_at: rel.published_at ?? rel.created_at,
        raw_text:            text.slice(0, 8000),
        raw_metadata: {
          repo:        fullName,
          tag:         rel.tag_name,
          is_prerelease: rel.prerelease,
          is_draft:    rel.draft,
          author:      rel.author?.login,
        },
        content_hash:      hash,
        processing_status: 'pending',
      });
    }

    if (rows.length > 0) {
      await supabase.from('raw_content')
        .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true });
    }

    return rows.length;
  } catch {
    return 0;
  }
}

async function ingestSecurityAdvisories(
  fullName:  string,
  projectId: string,
  channelId: string,
  name:      string,
): Promise<number> {
  try {
    const [owner, repo] = fullName.split('/');
    const { data: advisories } = await octokit.request(
      'GET /repos/{owner}/{repo}/security-advisories',
      { owner, repo, per_page: 5 }
    );

    const rows: Record<string, unknown>[] = [];
    for (const adv of (advisories as any[]) ?? []) {
      const text = [adv.summary, adv.description].filter(Boolean).join('\n\n');
      if (!text) continue;
      const url  = adv.html_url ?? `https://github.com/${fullName}/security/advisories`;
      const hash = contentHash(url, text);

      rows.push({
        project_id:          projectId,
        channel_id:          channelId,
        source_type:         'github_advisory',
        source_platform:     'GitHub Security',
        source_url:          url,
        content_published_at: adv.published_at ?? adv.created_at,
        raw_text:            text.slice(0, 8000),
        raw_metadata: {
          repo:      fullName,
          severity:  adv.severity,
          cvss:      adv.cvss?.score,
          cve:       adv.cve_id,
        },
        content_hash:      hash,
        processing_status: 'pending',
      });
    }

    if (rows.length > 0) {
      await supabase.from('raw_content')
        .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true });
    }

    return rows.length;
  } catch {
    return 0; // advisory endpoint may require auth or not exist
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
