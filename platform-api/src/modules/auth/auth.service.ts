import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { signTokenPair, verifyRefreshToken, type TokenPair } from '../../lib/jwt.js';
import { AppError } from '../../middleware/errors.js';

const BCRYPT_ROUNDS = 12;

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
  readonly user: { id: string; email: string; name: string; role: string };
  readonly org: { id: string; name: string; slug: string };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError('CONFLICT', 'Email already registered');
  }

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
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
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

export async function login(input: LoginInput): Promise<{ tokens: TokenPair; user: { id: string; email: string; name: string; role: string; orgId: string } }> {
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId },
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
