import { z } from 'zod';

export const ListCertsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(), // active | expiring | expired | revoked
});

export type ListCertsQuery = z.infer<typeof ListCertsSchema>;

export const CertIdSchema = z.object({
  id: z.string().uuid(),
});

export const ExpiringQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

export type ExpiringQuery = z.infer<typeof ExpiringQuerySchema>;
