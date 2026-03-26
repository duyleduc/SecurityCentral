import { z } from 'zod';

export const RegisterAgentSchema = z.object({
  hostname: z.string().min(1),
  osFamily: z.string().min(1),        // ubuntu | centos | alpine | rhel | debian
  osVersion: z.string().min(1),
  arch: z.enum(['amd64', 'arm64']).default('amd64'),
  cloudProvider: z.string().optional(), // aws | gcp | azure | null
  cloudRegion: z.string().optional(),
  cloudInstanceId: z.string().optional(),
  environment: z.enum(['production', 'staging', 'development']).default('production'),
  csr: z.string().min(1),              // PEM-encoded PKCS#10 CSR
});

export type RegisterAgentInput = z.infer<typeof RegisterAgentSchema>;

export const HeartbeatSchema = z.object({
  agentVersion: z.string().min(1),
  osFamily: z.string().optional(),
  osVersion: z.string().optional(),
  hostname: z.string().optional(),
  resourceUsage: z
    .object({
      cpuPercent: z.number().optional(),
      memoryPercent: z.number().optional(),
      diskPercent: z.number().optional(),
    })
    .optional(),
});

export type HeartbeatInput = z.infer<typeof HeartbeatSchema>;
