import { z } from 'zod';

export const CreateEndpointSchema = z.object({
  projectId: z.string().uuid().optional(),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(443),
  protocol: z.enum(['https', 'http']).default('https'),
  uptimeInterval: z.number().int().min(5).max(3600).default(15),
  uptimeTimeout: z.number().int().min(5).max(120).default(30),
});

export const UpdateEndpointSchema = z.object({
  uptimeInterval: z.number().int().min(5).max(3600).optional(),
  uptimeTimeout: z.number().int().min(5).max(120).optional(),
});

export const EndpointIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const HeartbeatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
