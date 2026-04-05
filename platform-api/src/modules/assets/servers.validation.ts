import { z } from 'zod';

export const ListServersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),          // active | inactive | decommissioned
  environment: z.string().optional(),      // production | staging | development
  os_family: z.string().optional(),        // ubuntu | centos | alpine | rhel | debian
});

export type ListServersQuery = z.infer<typeof ListServersSchema>;

export const ServerIdSchema = z.object({
  id: z.string().uuid(),
});

export const UpdateServerConfigSchema = z.object({
  tags: z.record(z.string()).optional(),
  scan: z.object({
    packages: z.boolean().optional(),
    compliance: z.boolean().optional(),
    interval: z.enum(['1h', '6h', '12h', '24h']).optional(),
    onStartup: z.boolean().optional(),
  }).optional(),
  heartbeat: z.object({
    interval: z.enum(['30s', '60s', '120s', '300s']).optional(),
  }).optional(),
});

export type UpdateServerConfigInput = z.infer<typeof UpdateServerConfigSchema>;
