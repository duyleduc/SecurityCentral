import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  notes: z.string().max(10000).optional(),
  banner: z.string().max(500).nullable().optional(),
});

export const ProjectIdParamsSchema = z.object({
  id: z.string().uuid(),
});
