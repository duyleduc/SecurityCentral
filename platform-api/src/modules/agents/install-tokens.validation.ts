import { z } from 'zod';

// ---------------------------------------------------------------------------
// Create install token (dashboard user → API)
// ---------------------------------------------------------------------------

export const CreateInstallTokenSchema = z.object({
  projectId: z.string().uuid().optional(),
  tags: z.record(z.string()).optional(),
  scan: z
    .object({
      packages: z.boolean().default(true),
      compliance: z.boolean().default(true),
      interval: z.string().default('6h'),
      onStartup: z.boolean().default(true),
    })
    .optional(),
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
});

export type CreateInstallTokenInput = z.infer<typeof CreateInstallTokenSchema>;

// ---------------------------------------------------------------------------
// Enroll agent (Go binary → API, using one-time token)
// ---------------------------------------------------------------------------

export const EnrollAgentSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1),
  osFamily: z.string().min(1),
  osVersion: z.string().min(1),
  arch: z.enum(['amd64', 'arm64']).default('amd64'),
  cloudProvider: z.string().optional(),
  cloudRegion: z.string().optional(),
  cloudInstanceId: z.string().optional(),
  csr: z.string().min(1),
});

export type EnrollAgentInput = z.infer<typeof EnrollAgentSchema>;
