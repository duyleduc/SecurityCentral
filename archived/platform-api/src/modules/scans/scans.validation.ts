import { z } from 'zod';

export const ListScansSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  scan_type: z.string().optional(),
  status: z.string().optional(),
  repository_id: z.string().uuid().optional(),
  server_id: z.string().uuid().optional(),
});

export type ListScansQuery = z.infer<typeof ListScansSchema>;

export const ScanIdSchema = z.object({
  id: z.string().uuid(),
});
