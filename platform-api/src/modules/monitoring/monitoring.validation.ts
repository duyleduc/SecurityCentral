import { z } from 'zod';

export const CreateEndpointSchema = z.object({
  projectId: z.string().uuid().optional(),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(443),
  protocol: z.enum(['https', 'http']).default('https'),
  checkInterval: z.enum(['1h', '6h', '24h']).default('1h'),
});

export const EndpointIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const HeartbeatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
