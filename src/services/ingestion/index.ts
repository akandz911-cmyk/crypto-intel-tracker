/**
 * Ingestion Orchestrator
 *
 * Runs every 15 minutes. Coordinates all ingesters, logs results
 * to system_jobs, and handles failures gracefully so one broken
 * ingester never stops the others.
 */

import { supabase } from '../../db/client';
import { logger } from '../../utils/logger';
import { ingestProjectRssFeeds, ingestNewsFeeds } from './rss-ingester';
import { ingestGitHubChannels } from './github-ingester';
import { ingestTwitterChannels, ingestTwitterSearch } from './twitter-ingester';

export async function runIngestion(): Promise<void> {
  logger.info('=== Ingestion cycle started ===');
  const start = Date.now();

  // Log job start
  const { data: jobRow } = await supabase
    .from('system_jobs')
    .insert({ job_name: 'ingestion', status: 'running' })
    .select('id')
    .single();
  const jobId = jobRow?.id;

  const results: Record<string, number> = {};
  const errors:  Record<string, string> = {};

  async function run(name: string, fn: () => Promise<number>): Promise<void> {
    try {
      logger.info(`Running: ${name}`);
      results[name] = await fn();
      logger.info(`${name}: ${results[name]} items`);
    } catch (err) {
      errors[name] = String(err);
      logger.warn(`${name} failed`, String(err).slice(0, 200));
    }
  }

  // Run all ingesters
  await run('rss_project_blogs', ingestProjectRssFeeds);
  await run('rss_news_outlets',  ingestNewsFeeds);
  await run('github_releases',   ingestGitHubChannels);
  await run('twitter_timelines', ingestTwitterChannels);
  await run('twitter_search',    ingestTwitterSearch);

  const totalItems = Object.values(results).reduce((a, b) => a + b, 0);
  const elapsed    = Math.round((Date.now() - start) / 1000);
  const hasErrors  = Object.keys(errors).length > 0;

  // Update job record
  if (jobId) {
    await supabase.from('system_jobs').update({
      status:          hasErrors ? 'failed' : 'completed',
      completed_at:    new Date().toISOString(),
      items_processed: totalItems,
      error_message:   hasErrors ? JSON.stringify(errors) : null,
      metadata:        { results, elapsed_seconds: elapsed },
    }).eq('id', jobId);
  }

  logger.info(`=== Ingestion done: ${totalItems} items in ${elapsed}s ===`);
}
