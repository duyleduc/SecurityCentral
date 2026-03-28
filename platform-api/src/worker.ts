import { Worker } from 'bullmq';
import express from 'express';

import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { getRedisConnection } from './lib/redis.js';
import { processors } from './jobs/processors.js';
import { scheduleEndpointChecks } from './jobs/domain-monitoring.processor.js';

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

  if (schedulerTimer) clearInterval(schedulerTimer);
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

// --- Domain monitoring scheduler (runs every 30s) ---

const SCHEDULER_INTERVAL_MS = 15_000; // poll every 15s to catch 1m intervals accurately
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function startScheduler(): void {
  // Run once on startup
  scheduleEndpointChecks()
    .then((n) => { if (n > 0) workerLog.info(`Scheduler: queued ${n} endpoint checks`); })
    .catch((err) => workerLog.error('Scheduler error', { error: (err as Error).message }));

  // Then run on interval
  schedulerTimer = setInterval(async () => {
    try {
      const queued = await scheduleEndpointChecks();
      if (queued > 0) workerLog.info(`Scheduler: queued ${queued} endpoint checks`);
    } catch (err) {
      workerLog.error('Scheduler error', { error: (err as Error).message });
    }
  }, SCHEDULER_INTERVAL_MS);
}

// --- Bootstrap ---

startWorkers();
startHealthServer();
startScheduler();

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

workerLog.info(`Started with ${workers.length} queue processors`);

export { workers, startWorkers, shutdown };
