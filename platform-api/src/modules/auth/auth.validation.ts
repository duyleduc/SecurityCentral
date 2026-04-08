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
