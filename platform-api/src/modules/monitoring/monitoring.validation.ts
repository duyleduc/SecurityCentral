import { z } from 'zod';

export const AddEndpointsBody = z.object({
  endpoints: z.array(
    z.object({
      host: z.string().min(1),
      port: z.coerce.number().int().min(1).max(65535).default(443),
      label: z.string().optional(),
    }),
  ).min(1).max(100),
  checkInterval: z.enum(['1h', '6h', '24h']).default('1h'),
});

export type AddEndpointsInput = z.infer<typeof AddEndpointsBody>;

export const ListEndpointsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(), // active | paused
});

export type ListEndpointsQueryType = z.infer<typeof ListEndpointsQuery>;

export const EndpointIdParams = z.object({
  id: z.string().uuid(),
});
