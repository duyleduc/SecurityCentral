import { z } from 'zod';

// Go's json.Marshal serializes nil slices as `null`. Zod's .default() only
// handles `undefined`, so we need .nullable() before .default() on every
// array field that could arrive as null from the Go agent.
function nullableArray<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).nullable().transform((v) => v ?? []);
}

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
    interfaces: nullableArray(z.object({
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
    top: nullableArray(z.object({
      pid: z.number().int(),
      name: z.string(),
      user: z.string(),
      cpu: z.number(),
      ram: z.number(),
    })).default([]),
  }).optional(),
  service: z.object({
    failedUnits: nullableArray(z.string()).default([]),
  }).optional(),
  docker: z.object({
    running: z.number().int(),
    stopped: z.number().int(),
    containers: nullableArray(z.object({
      id: z.string(),
      name: z.string(),
      image: z.string(),
      state: z.string(),
      cpu: z.number(),
      memory: z.number(),
      restarts: z.number().int(),
    })).default([]),
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
  alerts: nullableArray(AlertSchema).default([]),
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

export const UpdateServerSchema = z.object({
  label: z.string().max(100).optional(),
  hostname: z.string().min(1).max(255).optional(),
  projectId: z.string().uuid().nullable().optional(),
  tags: z.array(TagSchema).max(20).optional(),
});

export const SecurityPostureSchema = z.object({
  agentId: z.string().uuid(),
  collectedAt: z.string(),
  listeningPorts: nullableArray(z.object({
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
    defaultPolicy: z.string().optional(),
    issues: nullableArray(z.string()).optional(),
  }),
  loggedInUsers: nullableArray(z.object({
    user: z.string(),
    from: z.string(),
    since: z.string(),
  })).default([]),
  sshFailures: z.number().int().default(0),
  shellUsers: nullableArray(z.string()).default([]),
  pendingReboot: z.boolean().default(false),
  openFDs: z.object({
    allocated: z.number().int(),
    max: z.number(),
  }),
  auditResults: nullableArray(z.object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    status: z.enum(['pass', 'fail', 'warn']),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    detail: z.string(),
  })).default([]),
  bruteForce: z.object({
    sshVelocity: z.number().int().default(0),
    sshUniqueIps: z.number().int().default(0),
    sshTopAttackers: nullableArray(z.object({
      ip: z.string(),
      count: z.number().int(),
    })).default([]),
    sshCompromise: nullableArray(z.object({
      ip: z.string(),
      failuresBefore: z.number().int(),
      successUser: z.string(),
      successAt: z.string(),
    })).default([]),
    httpVelocity: z.number().int().default(0),
    httpUniqueIps: z.number().int().default(0),
    isActiveAttack: z.boolean().default(false),
    isDistributed: z.boolean().default(false),
    hasCompromise: z.boolean().default(false),
  }).optional(),
});

export const PackageInventorySchema = z.object({
  agentId: z.string().uuid(),
  collectedAt: z.string(),
  osFamily: z.string().max(50),
  packages: nullableArray(z.object({
    name: z.string(),
    version: z.string(),
    arch: z.string().optional(),
  })).default([]),
  binaryVersions: nullableArray(z.object({
    name: z.string(),
    version: z.string(),
  })).default([]),
  pendingSecurityUpdates: z.number().int().default(0),
  heldPackages: nullableArray(z.string()).default([]),
  kernelRunning: z.string().optional(),
  kernelInstalled: z.string().optional(),
  unattendedUpgrades: z.boolean().default(false),
  packageHash: z.string(),
});

export const SuspiciousProcessSchema = z.object({
  agentId: z.string().uuid(),
  collectedAt: z.string(),
  detections: nullableArray(z.object({
    pid: z.number().int(),
    name: z.string(),
    user: z.string(),
    cpu: z.number(),
    ram: z.number(),
    cmdline: z.string().max(2000),
    parentName: z.string(),
    reason: z.enum(['known_miner', 'high_cpu_sustained', 'reverse_shell', 'suspicious_path']),
    hasNetwork: z.boolean(),
    duration: z.number().int().default(0),
  })).default([]),
});
