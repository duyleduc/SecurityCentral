import { z } from 'zod';

export const MemberRoleSchema = z.enum(['member', 'admin']);

export const UpdateMemberRoleSchema = z.object({
  role: MemberRoleSchema,
});

export const MemberIdParamsSchema = z.object({
  id: z.string().uuid(),
});
