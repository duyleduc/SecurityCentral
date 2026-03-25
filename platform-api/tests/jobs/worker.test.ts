import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before importing anything that uses it
vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    disconnect: vi.fn(),
  }));
  return { default: MockRedis };
});

// Mock bullmq Worker and Queue
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_name: string, _processor: unknown, _opts: unknown) => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    name: _name,
  })),
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock prisma
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { finding: { findUnique: vi.fn() } },
}));

// Mock elasticsearch
vi.mock('../../src/lib/elasticsearch.js', () => ({
  upsertFinding: vi.fn().mockResolvedValue(undefined),
}));

import { processors } from '../../src/jobs/processors.js';
import { allQueues } from '../../src/jobs/queues.js';

describe('Worker Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('every queue has a matching processor', () => {
    for (const queue of allQueues) {
      expect(processors[queue.name]).toBeDefined();
    }
  });

  it('no orphan processors (processor without a queue)', () => {
    const queueNames = new Set(allQueues.map((q) => q.name));
    for (const name of Object.keys(processors)) {
      expect(queueNames.has(name)).toBe(true);
    }
  });
});
