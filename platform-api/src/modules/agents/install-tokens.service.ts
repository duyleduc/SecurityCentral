import crypto from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { signCsr } from '../../lib/ca.js';
import { AppError } from '../../middleware/errors.js';
import type { CreateInstallTokenInput, EnrollAgentInput } from './install-tokens.validation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = 'sctok_';

// ---------------------------------------------------------------------------
// Create an install token (called from dashboard)
// ---------------------------------------------------------------------------

interface CreateTokenResult {
  readonly id: string;
  readonly token: string;
  readonly tokenPrefix: string;
  readonly expiresAt: Date;
  readonly config: Record<string, unknown>;
}

export async function createInstallToken(
  orgId: string,
  userId: string,
  input: CreateInstallTokenInput,
): Promise<CreateTokenResult> {
  const rawToken = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenPrefix = rawToken.slice(0, TOKEN_PREFIX.length + 8);
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60 * 1000);

  const config: Record<string, unknown> = {
    environment: input.environment,
    ...(input.labels ? { labels: input.labels } : {}),
    scan: input.scan ?? { packages: true, compliance: true, interval: '6h', onStartup: true },
  };

  const record = await prisma.installToken.create({
    data: {
      orgId,
      createdBy: userId,
      tokenHash,
      tokenPrefix,
      config: config as object,
      expiresAt,
    },
  });

  return {
    id: record.id,
    token: rawToken,
    tokenPrefix,
    expiresAt,
    config,
  };
}

// ---------------------------------------------------------------------------
// Redeem an install token (called from Go agent binary)
// ---------------------------------------------------------------------------

interface EnrollResult {
  readonly agentId: string;
  readonly signedCert: string;
  readonly caCert: string;
  readonly config: Record<string, unknown>;
}

export async function redeemInstallToken(input: EnrollAgentInput): Promise<EnrollResult> {
  const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

  const token = await prisma.installToken.findUnique({
    where: { tokenHash },
  });

  if (!token) {
    throw new AppError('INSTALL_TOKEN_INVALID', 'Invalid install token');
  }

  if (token.usedAt) {
    throw new AppError('INSTALL_TOKEN_ALREADY_USED', 'This install token has already been used');
  }

  if (token.expiresAt < new Date()) {
    throw new AppError('INSTALL_TOKEN_EXPIRED', 'This install token has expired');
  }

  const config = token.config as Record<string, unknown>;
  const environment = (config.environment as string) ?? 'production';

  // Transaction: create server + mark token used
  const result = await prisma.$transaction(async (tx) => {
    const server = await tx.server.create({
      data: {
        orgId: token.orgId,
        hostname: input.hostname,
        osFamily: input.osFamily,
        osVersion: input.osVersion,
        arch: input.arch,
        cloudProvider: input.cloudProvider ?? null,
        cloudRegion: input.cloudRegion ?? null,
        cloudInstanceId: input.cloudInstanceId ?? null,
        environment,
        status: 'active',
        lastHeartbeat: new Date(),
      },
    });

    const agentId = server.id;

    await tx.server.update({
      where: { id: server.id },
      data: { agentId },
    });

    await tx.installToken.update({
      where: { id: token.id },
      data: {
        usedAt: new Date(),
        usedByServerId: server.id,
      },
    });

    const { certPem, caCertPem } = signCsr({ csrPem: input.csr, agentId });

    return { agentId, signedCert: certPem, caCert: caCertPem };
  });

  return { ...result, config };
}
