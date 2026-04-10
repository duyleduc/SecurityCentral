import { z } from 'zod';

export const RepositoryIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const RepositoryListQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  provider: z.enum(['github', 'gitlab']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const TriggerScanSchema = z.object({
  scanType: z.enum(['deps', 'secrets', 'configs', 'patterns', 'full']).default('full'),
  branch: z.string().optional(),
});

export const ScanHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
