import { runIngestion } from '../services/ingestion';
import { logger } from '../utils/logger';

(async () => {
  logger.info('=== Job: Ingestion ===');
  await runIngestion();
  logger.info('=== Job complete ===');
  process.exit(0);
})().catch(err => {
  logger.error('Job failed', String(err));
  process.exit(1);
});
