import { describe, it, expect } from 'vitest';

import { processors } from '../../src/jobs/processors.js';

describe('Queue Processors', () => {
  const expectedQueues = [
    'scan-orchestration',
    'finding-ingestion',
    'notifications',
    'vulndb-sync',
    'github-pr',
    'es-sync',
  ];

  it('should register a processor for every queue', () => {
    for (const name of expectedQueues) {
      expect(processors[name]).toBeDefined();
      expect(typeof processors[name].handler).toBe('function');
      expect(processors[name].concurrency).toBeGreaterThan(0);
    }
  });

  it('should have concurrency limits within reasonable bounds', () => {
    for (const [, config] of Object.entries(processors)) {
      expect(config.concurrency).toBeGreaterThanOrEqual(1);
      expect(config.concurrency).toBeLessThanOrEqual(50);
    }
  });

  it('es-sync processor should have higher concurrency for throughput', () => {
    expect(processors['es-sync'].concurrency).toBeGreaterThanOrEqual(5);
  });

  it('vulndb-sync processor should have low concurrency to avoid API throttling', () => {
    expect(processors['vulndb-sync'].concurrency).toBeLessThanOrEqual(5);
  });
});
