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
      loadAvg1: z.number().optional(),
      loadAvg5: z.number().optional(),
      loadAvg15: z.number().optional(),
      memUsedMb: z.number().optional(),
      memTotalMb: z.number().optional(),
      diskUsedGb: z.number().optional(),
      diskTotalGb: z.number().optional(),
      uptimeSecs: z.number().optional(),
    })
    .optional(),
  systemInfo: z
    .object({
      kernel: z.string().optional(),
      cpuCores: z.number().optional(),
      cpuModel: z.string().optional(),
      totalRamMb: z.number().optional(),
      totalDiskGb: z.number().optional(),
      ipAddresses: z.array(z.string()).optional(),
    })
    .optional(),
});

export type HeartbeatInput = z.infer<typeof HeartbeatSchema>;

// ---------------------------------------------------------------------------
// Finding submission
// ---------------------------------------------------------------------------

const FindingItemSchema = z.object({
  type: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string().min(1),
  description: z.string().optional(),
  cve_id: z.string().optional(),
  cvss_score: z.number().min(0).max(10).optional(),
  cvss_vector: z.string().optional(),
  detail: z.record(z.unknown()).default({}),
  remediation: z.string().optional(),
  auto_fixable: z.boolean().default(false),
});

export type FindingItem = z.infer<typeof FindingItemSchema>;

export const SubmitFindingsSchema = z.object({
  agent_id: z.string().min(1),
  scan_id: z.string().optional(),
  scan_type: z.enum([
    'code_dependencies',
    'code_secrets',
    'infra_packages',
    'infra_compliance',
    'cert_discovery',
    'cert_check',
  ]),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  findings: z.array(FindingItemSchema),
});

export type SubmitFindingsInput = z.infer<typeof SubmitFindingsSchema>;
