import { z } from 'zod';

export const ListReposSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  provider: z.string().optional(),
  language: z.string().optional(),
});

export type ListReposQuery = z.infer<typeof ListReposSchema>;

export const RepoIdSchema = z.object({
  id: z.string().uuid(),
});

export const CreateRepoSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'bitbucket']),
  providerId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().default('main'),
  language: z.string().optional(),
});
