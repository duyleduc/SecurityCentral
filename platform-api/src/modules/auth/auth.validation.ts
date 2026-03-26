import { z } from 'zod';

export const RegisterSchema = z.object({
  orgName: z.string().min(2).max(100),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const VALID_SCOPES = [
  'scan:write',
  'findings:read',
  'findings:write',
  'assets:read',
  'assets:write',
] as const;

export type ApiKeyScope = (typeof VALID_SCOPES)[number];

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(VALID_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
