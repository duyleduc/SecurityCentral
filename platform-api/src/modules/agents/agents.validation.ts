import { z } from 'zod';

const TagSchema = z.object({
  key: z.string().min(1).max(50),
  value: z.string().max(255).default(''),
});

export const CreateInstallTokenSchema = z.object({
  projectId: z.string().uuid().optional(),
  label: z.string().max(100).default(''),
  expiresInHours: z.number().int().min(1).max(168).default(24), // max 7 days
  tags: z.array(TagSchema).max(20).default([]),
});

export const AgentRegisterSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1).max(255),
  osFamily: z.string().max(50).optional(),
  osVersion: z.string().max(50).optional(),
  agentVersion: z.string().max(20).optional(),
});

const AlertSchema = z.object({
  type: z.string(),
  value: z.number(),
  threshold: z.number(),
  since: z.string().optional(),
});

const MetricsSchema = z.object({
  cpu: z.object({ avg: z.number(), max: z.number(), ioWait: z.number().default(0) }),
  ram: z.object({ avg: z.number(), max: z.number(), swapUsedPct: z.number().default(0) }),
  disk: z.object({
    usage: z.number(),
    ioErrors: z.number().default(0),
    readBps: z.number().default(0),
    writeBps: z.number().default(0),
    ioUtilPct: z.number().default(0),
  }),
  load: z.object({
    load1: z.number(),
    load5: z.number(),
    load15: z.number(),
  }).default({ load1: 0, load5: 0, load15: 0 }),
  network: z.object({
    rxBytesPerSec: z.number().default(0),
    txBytesPerSec: z.number().default(0),
    errors: z.number().default(0),
    drops: z.number().default(0),
    interfaces: z.array(z.object({
      name: z.string(),
      rxBytes: z.number(),
      txBytes: z.number(),
      errors: z.number(),
      drops: z.number(),
    })).default([]),
  }).default({ rxBytesPerSec: 0, txBytesPerSec: 0, errors: 0, drops: 0, interfaces: [] }),
  process: z.object({
    total: z.number().int(),
    zombies: z.number().int(),
    oomKills: z.number().int(),
    top: z.array(z.object({
      pid: z.number().int(),
      name: z.string(),
      user: z.string(),
      cpu: z.number(),
      ram: z.number(),
    })).default([]),
  }).optional(),
  service: z.object({
    failedUnits: z.array(z.string()).default([]),
  }).optional(),
});

const SystemInfoSchema = z.object({
  hostname: z.string().optional(),
  os: z.string().optional(),
  osVersion: z.string().optional(),
  kernel: z.string().optional(),
  arch: z.string().optional(),
  agentVersion: z.string().optional(),
  cpuCores: z.number().int().optional(),
  cpuModel: z.string().optional(),
  totalRamMb: z.number().int().optional(),
  totalDiskGb: z.number().int().optional(),
  ipAddresses: z.array(z.string()).optional(),
});

export const AgentHeartbeatSchema = z.object({
  agentId: z.string().uuid(),
  urgent: z.boolean().default(false),
  alerts: z.array(AlertSchema).default([]),
  metrics: MetricsSchema,
  system: SystemInfoSchema.optional(),
});

const FindingItemSchema = z.object({
  source: z.enum(['infra_agent']),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string().max(500),
  description: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
});

export const AgentFindingsSchema = z.object({
  agentId: z.string().uuid(),
  findings: z.array(FindingItemSchema).min(1).max(100),
});

export const ServerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ServerMetricsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

export const SecurityPostureSchema = z.object({
  agentId: z.string().uuid(),
  collectedAt: z.string(),
  listeningPorts: z.array(z.object({
    port: z.number().int(),
    proto: z.string(),
    process: z.string(),
    bind: z.string(),
  })).default([]),
  sshConfig: z.object({
    rootLogin: z.string(),
    passwordAuth: z.string(),
    port: z.number().int(),
    permitEmptyPwd: z.string(),
  }),
  firewall: z.object({
    active: z.boolean(),
    type: z.string(),
  }),
  loggedInUsers: z.array(z.object({
    user: z.string(),
    from: z.string(),
    since: z.string(),
  })).default([]),
  sshFailures: z.number().int().default(0),
  shellUsers: z.array(z.string()).default([]),
  pendingReboot: z.boolean().default(false),
  openFDs: z.object({
    allocated: z.number().int(),
    max: z.number().int(),
  }),
});
