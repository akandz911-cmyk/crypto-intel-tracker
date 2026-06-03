/**
 * Cron Scheduler — the heartbeat of the entire system.
 *
 * Schedule:
 *   Every 5 min  → AI processing (raw_content → events)
 *   Every 15 min → Full ingestion cycle (all sources)
 *   Every 24 hrs → Project discovery + significance re-scoring
 *   Every 7 days → Full channel refresh for all projects
 *
 * All jobs are wrapped in error isolation so one failure never
 * stops the rest of the pipeline.
 */

import cron from 'node-cron';
import { logger } from './utils/logger';
import { runProjectDiscovery } from './services/project-discovery';
import { refreshAllChannels } from './services/channel-discovery';
import { runIngestion } from './services/ingestion';
import { runAiProcessing } from './services/ai-processor';

// ── Job runner with error isolation ──────────────────────────

async function safeRun(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error(`Job "${name}" crashed — will retry on next schedule`, String(err).slice(0, 400));
    // Never rethrow — the scheduler must stay alive
  }
}

// ── Bootstrap ─────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('┌─────────────────────────────────────────────┐');
  logger.info('│  Crypto Intelligence Tracker — Starting up  │');
  logger.info('└─────────────────────────────────────────────┘');

  // On first startup, run discovery immediately so there's data to ingest
  logger.info('Running initial project discovery…');
  await safeRun('initial_discovery', runProjectDiscovery);

  logger.info('Running initial ingestion…');
  await safeRun('initial_ingestion', runIngestion);

  logger.info('Running initial AI processing…');
  await safeRun('initial_ai_processing', runAiProcessing);

  logger.info('Bootstrap complete. Scheduled jobs will now run automatically.');
}

// ── Cron schedules ────────────────────────────────────────────

function startScheduler(): void {
  // AI Processing: every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    safeRun('ai_processing', runAiProcessing);
  }, { timezone: 'UTC' });

  // Full ingestion: every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    safeRun('ingestion', runIngestion);
  }, { timezone: 'UTC' });

  // Project discovery + re-scoring: daily at 02:00 UTC
  cron.schedule('0 2 * * *', () => {
    safeRun('project_discovery', runProjectDiscovery);
  }, { timezone: 'UTC' });

  // Full channel refresh: every Sunday at 03:00 UTC
  cron.schedule('0 3 * * 0', () => {
    safeRun('channel_refresh', refreshAllChannels);
  }, { timezone: 'UTC' });

  logger.info('Cron schedules active:');
  logger.info('  AI processing   → every 5 min');
  logger.info('  Ingestion       → every 15 min');
  logger.info('  Project discovery → daily at 02:00 UTC');
  logger.info('  Channel refresh → weekly on Sunday 03:00 UTC');
}

// ── Graceful shutdown ─────────────────────────────────────────

function setupShutdown(): void {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully`);
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', err => {
    logger.error('Uncaught exception', String(err));
    // Stay alive — log the error but don't crash
  });
  process.on('unhandledRejection', reason => {
    logger.error('Unhandled rejection', String(reason));
  });
}

// ── Entry point ───────────────────────────────────────────────

(async () => {
  setupShutdown();
  await bootstrap();
  startScheduler();
})();
