import { refreshAllChannels } from '../services/channel-discovery';
import { logger } from '../utils/logger';

(async () => {
  logger.info('=== Job: Channel Refresh ===');
  await refreshAllChannels();
  logger.info('=== Job complete ===');
  process.exit(0);
})().catch(err => {
  logger.error('Job failed', String(err));
  process.exit(1);
});
