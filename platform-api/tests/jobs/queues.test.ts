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
    'cloud-discovery',
  ];

  it('should define all required queues', () => {
    expect(allQueues).toHaveLength(7);
  });

  it.each(expectedNames)('should include the "%s" queue', (name) => {
    const match = allQueues.find((q) => q.name === name);
    expect(match).toBeDefined();
  });
});
