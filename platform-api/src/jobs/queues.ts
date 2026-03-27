import { Queue } from 'bullmq';

import { getRedisConnection } from '../lib/redis.js';

function createQueue(name: string): Queue {
  return new Queue(name, { connection: getRedisConnection() });
}

// All BullMQ queues as defined in the spec
export const scanOrchestrationQueue = createQueue('scan-orchestration');
export const findingIngestionQueue = createQueue('finding-ingestion');
export const notificationsQueue = createQueue('notifications');
export const vulndbSyncQueue = createQueue('vulndb-sync');
export const githubPrQueue = createQueue('github-pr');
export const esSyncQueue = createQueue('es-sync');
export const cloudDiscoveryQueue = createQueue('cloud-discovery');

export const allQueues = [
  scanOrchestrationQueue,
  findingIngestionQueue,
  notificationsQueue,
  vulndbSyncQueue,
  githubPrQueue,
  esSyncQueue,
  cloudDiscoveryQueue,
] as const;
