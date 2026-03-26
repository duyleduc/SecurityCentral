import { Worker } from 'bullmq';
import express from 'express';

import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { getRedisConnection } from './lib/redis.js';
import { processors } from './jobs/processors.js';

const WORKER_PORT = env.PORT + 1; // worker health on a separate port

const workers: Worker[] = [];
const workerLog = logger.child({ component: 'worker' });

/**
 * Create BullMQ workers for every registered queue processor.
 */
function startWorkers(): void {
  const connection = getRedisConnection();

  for (const [queueName, { handler, concurrency }] of Object.entries(processors)) {
    const worker = new Worker(queueName, handler, {
      connection,
      concurrency,
    });

    worker.on('failed', (job, err) => {
      workerLog.error(`Job ${job?.id} in ${queueName} failed: ${err.message}`, { queue: queueName, job_id: job?.id });
    });

    worker.on('completed', (job) => {
      workerLog.debug(`Job ${job.id} in ${queueName} completed`, { queue: queueName, job_id: job.id });
    });

    workers.push(worker);
    workerLog.info(`Registered processor for "${queueName}"`, { queue: queueName, concurrency });
  }
}

/**
 * Graceful shutdown — close all workers, then exit.
 */
async function shutdown(signal: string): Promise<void> {
  workerLog.info(`Received ${signal}, shutting down gracefully...`);

  await Promise.allSettled(workers.map((w) => w.close()));
  workerLog.info('All workers closed');

  process.exit(0);
}

/**
 * Health check server for the worker process.
 */
function startHealthServer(): void {
  const app = express();

  app.get('/health', async (_req, res) => {
    const connection = getRedisConnection();

    try {
      const ping = await connection.ping();
      const isConnected = ping === 'PONG';

      res.status(isConnected ? 200 : 503).json({
        status: isConnected ? 'ok' : 'degraded',
        workers: workers.length,
        queues: Object.keys(processors),
        redis: isConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'degraded',
        workers: workers.length,
        queues: Object.keys(processors),
        redis: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.listen(WORKER_PORT, () => {
    workerLog.info(`Health check listening on port ${WORKER_PORT}`);
  });
}

// --- Bootstrap ---

startWorkers();
startHealthServer();

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

workerLog.info(`Started with ${workers.length} queue processors`);

export { workers, startWorkers, shutdown };
