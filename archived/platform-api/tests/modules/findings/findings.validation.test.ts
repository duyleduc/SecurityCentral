import { describe, it, expect } from 'vitest';

import {
  ListFindingsSchema,
  FindingIdSchema,
  UpdateFindingSchema,
  TrendsQuerySchema,
} from '../../../src/modules/findings/findings.validation.js';

describe('Findings Validation Schemas', () => {
  describe('ListFindingsSchema', () => {
    it('applies defaults for page and per_page', () => {
      const result = ListFindingsSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.per_page).toBe(50);
    });

    it('accepts valid filter params', () => {
      const result = ListFindingsSchema.parse({
        severity: 'critical,high',
        status: 'open',
        source: 'code_scanner',
        q: 'log4j',
        sort: 'cvss_score',
        order: 'desc',
        page: '2',
        per_page: '25',
      });

      expect(result.severity).toBe('critical,high');
      expect(result.q).toBe('log4j');
      expect(result.sort).toBe('cvss_score');
      expect(result.page).toBe(2);
      expect(result.per_page).toBe(25);
    });

    it('rejects invalid sort field', () => {
      expect(() => ListFindingsSchema.parse({ sort: 'invalid' })).toThrow();
    });

    it('rejects per_page > 200', () => {
      expect(() => ListFindingsSchema.parse({ per_page: '500' })).toThrow();
    });

    it('rejects page < 1', () => {
      expect(() => ListFindingsSchema.parse({ page: '0' })).toThrow();
    });
  });

  describe('FindingIdSchema', () => {
    it('accepts valid UUID', () => {
      const result = FindingIdSchema.parse({ id: '550e8400-e29b-41d4-a716-446655440000' });
      expect(result.id).toBeDefined();
    });

    it('rejects non-UUID', () => {
      expect(() => FindingIdSchema.parse({ id: 'not-a-uuid' })).toThrow();
    });
  });

  describe('UpdateFindingSchema', () => {
    it.each(['open', 'in_progress', 'resolved', 'suppressed', 'false_positive'])(
      'accepts status "%s"',
      (status) => {
        expect(UpdateFindingSchema.parse({ status }).status).toBe(status);
      },
    );

    it('rejects invalid status', () => {
      expect(() => UpdateFindingSchema.parse({ status: 'invalid' })).toThrow();
    });
  });

  describe('TrendsQuerySchema', () => {
    it('applies defaults', () => {
      const result = TrendsQuerySchema.parse({});
      expect(result.interval).toBe('day');
      expect(result.days).toBe(30);
    });

    it('accepts week interval', () => {
      const result = TrendsQuerySchema.parse({ interval: 'week', days: '90' });
      expect(result.interval).toBe('week');
      expect(result.days).toBe(90);
    });

    it('rejects days < 7', () => {
      expect(() => TrendsQuerySchema.parse({ days: '3' })).toThrow();
    });
  });
});
