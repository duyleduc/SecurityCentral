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
