import { z } from 'zod';

export const IntegrationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ProviderParamsSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
});

export const ConnectGitHubSchema = z.object({
  installationId: z.string().min(1),
  appId: z.string().min(1).optional(),
});

export const ConnectGitLabSchema = z.object({
  accessToken: z.string().min(1),
  baseUrl: z.string().url().optional(),
  verifySsl: z.boolean().default(true),
});

export const SyncReposSchema = z.object({
  repos: z.array(
    z.object({
      providerId: z.string().min(1),
      name: z.string().min(1),
      owner: z.string().min(1),
      defaultBranch: z.string().default('main'),
      language: z.string().nullable().default(null),
      cloneUrl: z.string().min(1),
      private: z.boolean().default(false),
    }),
  ).min(1),
  projectId: z.string().uuid().optional(),
});

export const RepoListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().optional(),
});
