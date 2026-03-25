import { describe, it, expect } from 'vitest';

import { allQueues } from '../../src/jobs/queues.js';

describe('BullMQ Queues', () => {
  const expectedNames = [
    'scan-orchestration',
    'finding-ingestion',
    'notifications',
    'vulndb-sync',
    'github-pr',
    'es-sync',
  ];

  it('should define all 6 required queues', () => {
    expect(allQueues).toHaveLength(6);
  });

  it.each(expectedNames)('should include the "%s" queue', (name) => {
    const match = allQueues.find((q) => q.name === name);
    expect(match).toBeDefined();
  });
});
