import { z } from 'zod';

export const CreateInstallTokenSchema = z.object({
  projectId: z.string().uuid().optional(),
  label: z.string().max(100).default(''),
  expiresInHours: z.number().int().min(1).max(168).default(24), // max 7 days
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
  cpu: z.object({ avg: z.number(), max: z.number() }),
  ram: z.object({ avg: z.number(), max: z.number() }),
  disk: z.object({ usage: z.number(), ioErrors: z.number().default(0) }),
});

const SystemInfoSchema = z.object({
  hostname: z.string().optional(),
  os: z.string().optional(),
  agentVersion: z.string().optional(),
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
