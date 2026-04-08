import { z } from 'zod';

export const ListAuditLogsSchema = z.object({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  actor_id: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});
