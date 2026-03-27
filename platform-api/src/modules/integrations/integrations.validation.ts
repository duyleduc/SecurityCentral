import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provider repo discovery
// ---------------------------------------------------------------------------

export const ListProviderReposQuery = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListProviderReposQueryType = z.infer<typeof ListProviderReposQuery>;

// ---------------------------------------------------------------------------
// Repo sync / unsync
// ---------------------------------------------------------------------------

export const SyncReposBody = z.object({
  repo_ids: z.array(z.string().min(1)).min(1).max(200),
});

export const ProviderParam = z.object({
  provider: z.enum(['github', 'gitlab']),
});

export const UnsyncRepoParams = z.object({
  provider: z.enum(['github', 'gitlab']),
  id: z.string().min(1),
});
