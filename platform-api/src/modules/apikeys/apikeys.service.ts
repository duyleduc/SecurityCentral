import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';

export async function list(orgId: string) {
  return prisma.apiKey.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

interface CreateKeyInput {
  readonly orgId: string;
  readonly createdBy: string;
  readonly name: string;
  readonly scopes?: string[];
  readonly expiresInDays?: number;
}

export async function create(input: CreateKeyInput) {
  const rawKey = `sc_live_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const apiKey = await prisma.apiKey.create({
    data: {
      orgId: input.orgId,
      createdBy: input.createdBy,
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: JSON.parse(JSON.stringify(input.scopes ?? [])),
      expiresAt,
    },
  });

  // Return the raw key only on creation — it's never stored
  return {
    id: apiKey.id,
    name: apiKey.name,
    key: rawKey,
    keyPrefix,
    expiresAt,
    createdAt: apiKey.createdAt,
  };
}

export async function revoke(orgId: string, id: string) {
  const existing = await prisma.apiKey.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'API key not found');
  }
  await prisma.apiKey.delete({ where: { id } });
}
