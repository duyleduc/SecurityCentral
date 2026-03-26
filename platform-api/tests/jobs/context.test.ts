import { describe, it, expect, vi } from 'vitest';

// Mock ioredis
vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    disconnect: vi.fn(),
  }));
  return { default: MockRedis };
});

// Mock bullmq
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { enqueueFindingSync, enqueueFindingSyncBatch } from '../../src/modules/findings/sync.js';
import { esSyncQueue } from '../../src/jobs/queues.js';

describe('Job Context — request_id propagation', () => {
  it('enqueueFindingSync includes request_id in job data', async () => {
    await enqueueFindingSync('finding-1', 'req-abc');

    expect(esSyncQueue.add).toHaveBeenCalledWith(
      'sync-finding',
      expect.objectContaining({ findingId: 'finding-1', request_id: 'req-abc' }),
      expect.any(Object),
    );
  });

  it('enqueueFindingSync passes undefined request_id when not provided', async () => {
    await enqueueFindingSync('finding-2');

    expect(esSyncQueue.add).toHaveBeenCalledWith(
      'sync-finding',
      expect.objectContaining({ findingId: 'finding-2', request_id: undefined }),
      expect.any(Object),
    );
  });

  it('enqueueFindingSyncBatch includes request_id in all jobs', async () => {
    await enqueueFindingSyncBatch(['f1', 'f2'], 'req-xyz');

    expect(esSyncQueue.addBulk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ findingId: 'f1', request_id: 'req-xyz' }) }),
        expect.objectContaining({ data: expect.objectContaining({ findingId: 'f2', request_id: 'req-xyz' }) }),
      ]),
    );
  });
});
