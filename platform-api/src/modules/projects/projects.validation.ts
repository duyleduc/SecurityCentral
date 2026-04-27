import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
});

const TagSchema = z.object({
  key: z.string().min(1).max(50),
  value: z.string().max(100),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  notes: z.string().max(10000).optional(),
  banner: z.string().max(500).nullable().optional(),
  tags: z.array(TagSchema).max(50).optional(),
});

export const ProjectIdParamsSchema = z.object({
  id: z.string().uuid(),
});
