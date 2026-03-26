import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { signTokenPair, verifyRefreshToken, type TokenPair } from '../../lib/jwt.js';
import { AppError } from '../../middleware/errors.js';
import type { ApiKeyScope } from './auth.validation.js';

const BCRYPT_ROUNDS = 12;
const API_KEY_PREFIX = 'sc_live_';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

interface RegisterInput {
  readonly orgName: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

interface RegisterResult {
  readonly tokens: TokenPair;
  readonly user: { id: string; email: string; role: string };
  readonly org: { id: string; name: string; slug: string };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const org = await prisma.organization.create({
    data: {
      name: input.orgName,
      slug: slugify(input.orgName) + '-' + crypto.randomBytes(3).toString('hex'),
      users: {
        create: {
          email: input.email,
          name: input.name,
          role: 'owner',
          passwordHash,
        },
      },
    },
    include: { users: true },
  });

  const user = org.users[0];
  const tokens = signTokenPair({ sub: user.id, org: org.id, role: user.role });

  return {
    tokens,
    user: { id: user.id, email: user.email, role: user.role },
    org: { id: org.id, name: org.name, slug: org.slug },
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export async function login(input: LoginInput): Promise<{ tokens: TokenPair; user: { id: string; email: string; role: string; orgId: string } }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const tokens = signTokenPair({ sub: user.id, org: user.orgId, role: user.role });

  return {
    tokens,
    user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
  };
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export async function refresh(refreshToken: string): Promise<TokenPair> {
  let userId: string;
  try {
    userId = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('AUTH_TOKEN_EXPIRED', 'Refresh token is invalid or expired');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('AUTH_TOKEN_EXPIRED', 'User not found');
  }

  return signTokenPair({ sub: user.id, org: user.orgId, role: user.role });
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

interface CreateApiKeyInput {
  readonly orgId: string;
  readonly createdBy: string;
  readonly name: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly expiresInDays?: number;
}

interface CreateApiKeyResult {
  readonly id: string;
  readonly rawKey: string;
  readonly keyPrefix: string;
  readonly name: string;
  readonly scopes: string[];
  readonly expiresAt: Date | null;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
  const rawKey = API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, API_KEY_PREFIX.length + 8);

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
      scopes: [...input.scopes],
      expiresAt,
    },
  });

  return {
    id: apiKey.id,
    rawKey,
    keyPrefix,
    name: apiKey.name,
    scopes: apiKey.scopes,
    expiresAt: apiKey.expiresAt,
  };
}

export async function listApiKeys(orgId: string) {
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
      createdBy: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeApiKey(orgId: string, keyId: string): Promise<void> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: keyId, orgId },
  });

  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'API key not found');
  }

  await prisma.apiKey.delete({ where: { id: keyId } });
}

/**
 * Authenticate via raw API key.
 * Returns the key record with org/user context, or throws.
 */
export async function authenticateApiKey(rawKey: string) {
  const prefix = rawKey.slice(0, API_KEY_PREFIX.length + 8);
  const candidates = await prisma.apiKey.findMany({
    where: { keyPrefix: prefix },
  });

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const match = candidates.find((k) => k.keyHash === keyHash);

  if (!match) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid API key');
  }

  if (match.expiresAt && match.expiresAt < new Date()) {
    throw new AppError('AUTH_TOKEN_EXPIRED', 'API key has expired');
  }

  // Update last_used_at (fire and forget)
  prisma.apiKey.update({ where: { id: match.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return match;
}
