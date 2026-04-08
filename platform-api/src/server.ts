import { app } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler } from './scheduler.js';

const server = app.listen(env.PORT, () => {
  logger.info(`Platform API listening on port ${env.PORT}`, { env: env.NODE_ENV });
  startScheduler();
});

function shutdown() {
  logger.info('Shutting down...');
  stopScheduler();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
