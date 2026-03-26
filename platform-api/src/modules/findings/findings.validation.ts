import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /findings query params
// ---------------------------------------------------------------------------

export const ListFindingsSchema = z.object({
  severity: z.string().optional(),           // comma-separated: critical,high
  status: z.string().optional(),             // comma-separated: open,in_progress
  source: z.string().optional(),             // comma-separated: code_scanner,infra_agent
  cve_id: z.string().optional(),
  repository_id: z.string().uuid().optional(),
  server_id: z.string().uuid().optional(),
  certificate_id: z.string().uuid().optional(),
  q: z.string().optional(),                  // full-text search
  sort: z.enum(['severity', 'cvss_score', 'first_seen_at', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListFindingsQuery = z.infer<typeof ListFindingsSchema>;

// ---------------------------------------------------------------------------
// GET /findings/:id params
// ---------------------------------------------------------------------------

export const FindingIdSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// PATCH /findings/:id body
// ---------------------------------------------------------------------------

const ALLOWED_STATUSES = ['open', 'in_progress', 'resolved', 'suppressed', 'false_positive'] as const;

export const UpdateFindingSchema = z.object({
  status: z.enum(ALLOWED_STATUSES),
});

// ---------------------------------------------------------------------------
// GET /findings/stats query params
// ---------------------------------------------------------------------------

export const StatsQuerySchema = z.object({
  source: z.string().optional(),
});

// ---------------------------------------------------------------------------
// GET /findings/trends query params
// ---------------------------------------------------------------------------

export const TrendsQuerySchema = z.object({
  interval: z.enum(['day', 'week']).default('day'),
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export type TrendsQuery = z.infer<typeof TrendsQuerySchema>;
