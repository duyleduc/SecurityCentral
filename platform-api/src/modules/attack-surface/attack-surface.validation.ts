import { z } from 'zod';

export const TriggerScanSchema = z.object({
  checkAdminPanels: z.boolean().default(true),
});

export const ScanIdParamsSchema = z.object({
  id: z.string().uuid(),
});
