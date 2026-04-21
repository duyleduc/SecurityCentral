import { randomBytes } from 'node:crypto';

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { env } from '../../lib/env.js';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function list(orgId: string) {
  return prisma.integration.findMany({
    where: { orgId },
    select: {
      id: true,
      provider: true,
      baseUrl: true,
      verifySsl: true,
      status: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { repositories: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(orgId: string, id: string) {
  const integration = await prisma.integration.findFirst({
    where: { id, orgId },
  });
  if (!integration) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Integration not found');
  }
  return integration;
}

export async function remove(orgId: string, id: string) {
  const existing = await prisma.integration.findFirst({ where: { id, orgId } });
  if (!existing) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Integration not found');
  }
  await prisma.integration.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// GitHub App
// ---------------------------------------------------------------------------

interface ConnectGitHubInput {
  readonly orgId: string;
  readonly installationId: string;
  readonly appId?: string;
}

export async function connectGitHub(input: ConnectGitHubInput) {
  const webhookSecret = randomBytes(32).toString('hex');
  const appId = input.appId ?? env.GITHUB_APP_ID;

  return prisma.integration.upsert({
    where: { orgId_provider: { orgId: input.orgId, provider: 'github' } },
    create: {
      orgId: input.orgId,
      provider: 'github',
      config: { installationId: input.installationId, appId },
      webhookSecret,
      status: 'active',
    },
    update: {
      config: { installationId: input.installationId, appId },
      webhookSecret,
      status: 'active',
      enabled: true,
    },
  });
}

// ---------------------------------------------------------------------------
// GitHub Personal Access Token (simpler than GitHub App — no registration needed)
// ---------------------------------------------------------------------------

interface ConnectGitHubPatInput {
  readonly orgId: string;
  readonly accessToken: string;
  readonly baseUrl?: string;
  readonly verifySsl?: boolean;
}

export async function connectGitHubPat(input: ConnectGitHubPatInput) {
  const webhookSecret = randomBytes(32).toString('hex');

  return prisma.integration.upsert({
    where: { orgId_provider: { orgId: input.orgId, provider: 'github' } },
    create: {
      orgId: input.orgId,
      provider: 'github',
      config: { accessToken: input.accessToken },
      baseUrl: input.baseUrl ?? null,
      verifySsl: input.verifySsl ?? true,
      webhookSecret,
      status: 'active',
    },
    update: {
      config: { accessToken: input.accessToken },
      baseUrl: input.baseUrl ?? null,
      verifySsl: input.verifySsl ?? true,
      webhookSecret,
      status: 'active',
      enabled: true,
    },
  });
}

// ---------------------------------------------------------------------------
// GitLab PAT
// ---------------------------------------------------------------------------

interface ConnectGitLabInput {
  readonly orgId: string;
  readonly accessToken: string;
  readonly baseUrl?: string;
  readonly verifySsl?: boolean;
}

export async function connectGitLab(input: ConnectGitLabInput) {
  const webhookSecret = randomBytes(32).toString('hex');

  return prisma.integration.upsert({
    where: { orgId_provider: { orgId: input.orgId, provider: 'gitlab' } },
    create: {
      orgId: input.orgId,
      provider: 'gitlab',
      config: { accessToken: input.accessToken },
      baseUrl: input.baseUrl ?? null,
      verifySsl: input.verifySsl ?? true,
      webhookSecret,
      status: 'active',
    },
    update: {
      config: { accessToken: input.accessToken },
      baseUrl: input.baseUrl ?? null,
      verifySsl: input.verifySsl ?? true,
      webhookSecret,
      status: 'active',
      enabled: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Sync repos from provider into platform
// ---------------------------------------------------------------------------

interface SyncRepoEntry {
  readonly providerId: string;
  readonly name: string;
  readonly owner: string;
  readonly defaultBranch: string;
  readonly language: string | null;
  readonly cloneUrl: string;
}

export async function syncRepos(
  orgId: string,
  provider: string,
  repos: readonly SyncRepoEntry[],
  projectId?: string,
) {
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider },
  });
  if (!integration) {
    throw new AppError('RESOURCE_NOT_FOUND', `No ${provider} integration found`);
  }

  const results = await Promise.all(
    repos.map((repo) =>
      prisma.repository.upsert({
        where: {
          orgId_provider_providerId: {
            orgId,
            provider,
            providerId: repo.providerId,
          },
        },
        create: {
          orgId,
          projectId: projectId ?? null,
          integrationId: integration.id,
          provider,
          providerId: repo.providerId,
          owner: repo.owner,
          name: repo.name,
          defaultBranch: repo.defaultBranch,
          language: repo.language,
          cloneUrl: repo.cloneUrl,
        },
        update: {
          name: repo.name,
          owner: repo.owner,
          defaultBranch: repo.defaultBranch,
          language: repo.language,
          cloneUrl: repo.cloneUrl,
          projectId: projectId ?? undefined,
        },
      }),
    ),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Helpers for webhook processing
// ---------------------------------------------------------------------------

export async function getIntegrationByProvider(orgId: string, provider: string) {
  return prisma.integration.findFirst({
    where: { orgId, provider, enabled: true },
  });
}

export async function findIntegrationByWebhookSecret(provider: string, secret: string) {
  return prisma.integration.findFirst({
    where: { provider, webhookSecret: secret, enabled: true },
  });
}

export async function findRepoByProviderAndName(
  orgId: string,
  provider: string,
  owner: string,
  name: string,
) {
  return prisma.repository.findFirst({
    where: { orgId, provider, owner, name },
    include: { integration: true },
  });
}
