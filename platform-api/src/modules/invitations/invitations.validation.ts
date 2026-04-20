import { z } from 'zod';

export const RoleSchema = z.enum(['member', 'admin']);

export const CreateInvitationSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  role: RoleSchema.default('member'),
  expiresInHours: z.number().int().min(1).max(720).optional(), // up to 30 days
});

export const InvitationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const InvitationTokenParamsSchema = z.object({
  token: z.string().min(10).max(128),
});

export const AcceptInvitationSchema = z.object({
  password: z.string().min(8).max(128),
});
