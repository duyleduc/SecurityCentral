import { z } from 'zod';

export const AddEndpointsBody = z.object({
  endpoints: z.array(
    z.object({
      host: z.string().min(1),
      port: z.coerce.number().int().min(1).max(65535).default(443),
      label: z.string().optional(),
      tags: z.record(z.string()).optional(), // key-value pairs
    }),
  ).min(1).max(100),
  checkInterval: z.enum(['30s', '1m', '5m', '15m', '30m', '1h', '6h', '24h']).default('1m'),
  projectId: z.string().uuid().optional(),
});

export type AddEndpointsInput = z.infer<typeof AddEndpointsBody>;

export const UpdateEndpointBody = z.object({
  label: z.string().optional(),
  tags: z.record(z.string()).optional(),
  checkInterval: z.enum(['30s', '1m', '5m', '15m', '30m', '1h', '6h', '24h']).optional(),
});

export type UpdateEndpointInput = z.infer<typeof UpdateEndpointBody>;

export const ListEndpointsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  projectId: z.string().uuid().optional(),
  project_ids: z.string().optional(), // comma-separated project UUIDs
  tag: z.string().optional(), // filter by tag key, e.g. "env" or "env:prod"
  tags: z.string().optional(), // comma-separated key=value pairs (AND condition)
});

export type ListEndpointsQueryType = z.infer<typeof ListEndpointsQuery>;

export const EndpointIdParams = z.object({
  id: z.string().uuid(),
});
