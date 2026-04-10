import { createServer } from 'node:http';

import { app } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { setupSocketIO } from './ws/server.js';

const httpServer = createServer(app);

// Attach Socket.IO to the HTTP server
setupSocketIO(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`Platform API listening on port ${env.PORT}`, { env: env.NODE_ENV });
  startScheduler();
});

function shutdown() {
  logger.info('Shutting down...');
  stopScheduler();
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
