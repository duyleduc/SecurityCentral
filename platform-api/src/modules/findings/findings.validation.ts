import { z } from 'zod';

export const FindingIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const FindingsListQuerySchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  status: z.enum(['open', 'in_progress', 'resolved', 'suppressed', 'false_positive']).optional(),
  source: z.enum(['code_scanner', 'infra_agent', 'cert_monitor', 'cve_scan', 'security_audit', 'brute_force']).optional(),
  repositoryId: z.string().uuid().optional(),
  serverId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

export const UpdateFindingSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'suppressed', 'false_positive']),
});
