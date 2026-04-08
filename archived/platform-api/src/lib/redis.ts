import IORedis from 'ioredis';

import { env } from './env.js';

let connectionInstance: IORedis | null = null;

/**
 * Get the shared Redis connection for BullMQ and caching.
 * BullMQ requires an ioredis instance.
 */
export function getRedisConnection(): IORedis {
  if (connectionInstance) return connectionInstance;

  connectionInstance = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
  });

  return connectionInstance;
}
