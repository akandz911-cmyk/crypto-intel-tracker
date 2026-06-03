import { runProjectDiscovery } from '../services/project-discovery';
import { logger } from '../utils/logger';

(async () => {
  logger.info('=== Job: Project Discovery ===');
  await runProjectDiscovery();
  logger.info('=== Job complete ===');
  process.exit(0);
})().catch(err => {
  logger.error('Job failed', String(err));
  process.exit(1);
});
