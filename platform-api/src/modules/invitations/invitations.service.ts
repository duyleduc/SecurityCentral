import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { signTokenPair, type TokenPair } from '../../lib/jwt.js';
import { isMailEnabled, sendInvitationEmail } from '../../lib/mailer.js';
import { AppError } from '../../middleware/errors.js';

const BCRYPT_ROUNDS = 12;
const DEFAULT_EXPIRY_HOURS = 168; // 7 days

type Role = 'member' | 'admin';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Admin: create / list / revoke
// ---------------------------------------------------------------------------

interface CreateInvitationInput {
  readonly orgId: string;
  readonly createdBy: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly expiresInHours?: number;
}

interface CreateInvitationResult {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly expiresAt: Date;
  /** Raw token — returned ONCE to the admin, then stored as SHA-256 hash. */
  readonly token: string;
  /** Full URL the invitee opens to accept the invitation. */
  readonly acceptUrl: string;
  /** Whether an email was sent successfully. False if mail is not configured or delivery failed. */
  readonly emailSent: boolean;
}

function buildAcceptUrl(token: string): string {
  const base = env.DASHBOARD_BASE_URL.replace(/\/+$/, '');
  return `${base}/invite/${token}`;
}

export async function createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw new AppError('CONFLICT', 'A user with this email already exists');
  }

  // Revoke any pending invite for the same email in this org — only one live invite at a time.
  await prisma.invitation.deleteMany({
    where: { orgId: input.orgId, email: input.email, acceptedAt: null },
  });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const hours = input.expiresInHours ?? DEFAULT_EXPIRY_HOURS;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const invite = await prisma.invitation.create({
    data: {
      orgId: input.orgId,
      createdBy: input.createdBy,
      name: input.name,
      email: input.email,
      role: input.role,
      tokenHash,
      expiresAt,
    },
    include: { org: { select: { name: true } } },
  });

  const acceptUrl = buildAcceptUrl(rawToken);

  // Best-effort email delivery. Failure shouldn't fail the request — the admin
  // still gets the raw URL and can share it manually.
  let emailSent = false;
  if (isMailEnabled()) {
    const [inviter] = await prisma.$transaction([
      prisma.user.findUnique({ where: { id: input.createdBy }, select: { name: true } }),
    ]);
    try {
      await sendInvitationEmail({
        to: input.email,
        inviteeName: input.name,
        orgName: invite.org.name,
        inviterName: inviter?.name ?? 'A teammate',
        role: input.role,
        acceptUrl,
        expiresAt,
      });
      emailSent = true;
    } catch (err) {
      logger.error('[invitations] email delivery failed', {
        to: input.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role as Role,
    expiresAt: invite.expiresAt,
    token: rawToken,
    acceptUrl,
    emailSent,
  };
}

export async function listPending(orgId: string) {
  return prisma.invitation.findMany({
    where: { orgId, acceptedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeInvitation(orgId: string, id: string): Promise<void> {
  const invite = await prisma.invitation.findFirst({ where: { id, orgId } });
  if (!invite) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Invitation not found');
  }
  if (invite.acceptedAt) {
    throw new AppError('VALIDATION_ERROR', 'Cannot revoke an invitation that has already been accepted');
  }
  await prisma.invitation.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Public: view invite + accept
// ---------------------------------------------------------------------------

export async function getByToken(rawToken: string) {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { org: { select: { id: true, name: true } } },
  });
  if (!invite) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Invalid or expired invitation link');
  }
  if (invite.acceptedAt) {
    throw new AppError('VALIDATION_ERROR', 'This invitation has already been accepted');
  }
  if (invite.expiresAt < new Date()) {
    throw new AppError('VALIDATION_ERROR', 'This invitation has expired');
  }
  return {
    email: invite.email,
    name: invite.name,
    role: invite.role as Role,
    org: invite.org,
    expiresAt: invite.expiresAt,
  };
}

interface AcceptInvitationResult {
  readonly tokens: TokenPair;
  readonly user: { id: string; email: string; role: string; orgId: string };
}

export async function acceptInvitation(rawToken: string, password: string): Promise<AcceptInvitationResult> {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!invite) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Invalid or expired invitation link');
  }
  if (invite.acceptedAt) {
    throw new AppError('VALIDATION_ERROR', 'This invitation has already been accepted');
  }
  if (invite.expiresAt < new Date()) {
    throw new AppError('VALIDATION_ERROR', 'This invitation has expired');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existingUser) {
    throw new AppError('CONFLICT', 'A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [, user] = await prisma.$transaction([
    prisma.invitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
    prisma.user.create({
      data: {
        orgId: invite.orgId,
        name: invite.name,
        email: invite.email,
        role: invite.role,
        passwordHash,
      },
    }),
  ]);

  const tokens = signTokenPair({ sub: user.id, org: user.orgId, role: user.role });
  return {
    tokens,
    user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
  };
}
