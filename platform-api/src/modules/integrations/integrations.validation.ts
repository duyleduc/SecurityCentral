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
  project_id: z.string().uuid().optional(),
});

export const ProviderParam = z.object({
  provider: z.enum(['github', 'gitlab']),
});

export const UnsyncRepoParams = z.object({
  provider: z.enum(['github', 'gitlab']),
  id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Cloud discovery
// ---------------------------------------------------------------------------

export const ConnectAwsBody = z.object({
  region: z.string().min(1),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  roleArn: z.string().optional(),
});

export const ConnectAzureBody = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  subscriptionId: z.string().optional(),
});

export const ConnectGcpBody = z.object({
  projectId: z.string().min(1),
  serviceAccountKey: z.string().optional(),
});

export const ConnectProxmoxBody = z.object({
  baseUrl: z.string().url(),
  tokenId: z.string().min(1),
  tokenSecret: z.string().min(1),
  verifySsl: z.boolean().default(true),
});

export const CloudProviderParam = z.object({
  provider: z.enum(['aws', 'azure', 'gcp', 'proxmox']),
});

export const ListCloudResourcesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  region: z.string().optional(),
  status: z.string().optional(),
});
