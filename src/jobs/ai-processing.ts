import { runAiProcessing } from '../services/ai-processor';
import { logger } from '../utils/logger';

(async () => {
  logger.info('=== Job: AI Processing ===');
  await runAiProcessing();
  logger.info('=== Job complete ===');
  process.exit(0);
})().catch(err => {
  logger.error('Job failed', String(err));
  process.exit(1);
});
