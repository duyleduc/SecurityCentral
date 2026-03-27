import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { GitHubClient } from '../../lib/github.js';
import { scanOrchestrationQueue } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'integrations' });

// ---------------------------------------------------------------------------
// GitHub OAuth / App installation
// ---------------------------------------------------------------------------

export async function createGitHubIntegration(orgId: string, installationId: string, appId: string) {
  const existing = await prisma.integration.findFirst({
    where: { orgId, provider: 'github' },
  });

  if (existing) {
    throw new AppError('INTEGRATION_ALREADY_EXISTS', 'GitHub integration already exists for this organization');
  }

  return prisma.integration.create({
    data: {
      orgId,
      provider: 'github',
      status: 'active',
      config: { installation_id: installationId, app_id: appId },
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook: push event → trigger scan
// ---------------------------------------------------------------------------

export async function handlePushEvent(payload: {
  repository: { id: number; full_name: string };
  ref: string;
  installation?: { id: number };
}) {
  const providerId = String(payload.repository.id);

  const repo = await prisma.repository.findFirst({
    where: { providerId, provider: 'github' },
  });

  if (!repo) {
    log.warn('Push event for unknown repository', { providerId, fullName: payload.repository.full_name });
    return;
  }

  // Only scan pushes to the default branch
  const ref = payload.ref.replace('refs/heads/', '');
  if (ref !== repo.defaultBranch) {
    log.debug('Ignoring push to non-default branch', { ref, defaultBranch: repo.defaultBranch });
    return;
  }

  log.info('Triggering scan from push event', { repoId: repo.id, ref });

  // Check for active scan
  const active = await prisma.scan.findFirst({
    where: { repositoryId: repo.id, status: { in: ['pending', 'running'] } },
  });

  if (active) {
    log.info('Scan already active, skipping', { scanId: active.id });
    return;
  }

  const scan = await prisma.scan.create({
    data: {
      orgId: repo.orgId,
      scanType: 'code_dependencies',
      status: 'pending',
      trigger: 'webhook',
      repositoryId: repo.id,
    },
  });

  await scanOrchestrationQueue.add('scan-repository', {
    scanId: scan.id,
    repositoryId: repo.id,
    orgId: repo.orgId,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
  });
}

// ---------------------------------------------------------------------------
// Webhook: installation event → auto-discover repos
// ---------------------------------------------------------------------------

export async function handleInstallationEvent(payload: {
  action: string;
  installation: { id: number; app_id: number; account: { login: string } };
  repositories?: Array<{ id: number; name: string; full_name: string; default_branch: string }>;
}) {
  if (payload.action !== 'created' && payload.action !== 'added') {
    return;
  }

  const installationId = String(payload.installation.id);

  // Find org by installation_id in integrations
  const integration = await prisma.integration.findFirst({
    where: { provider: 'github', config: { path: ['installation_id'], equals: installationId } },
  });

  if (!integration) {
    log.warn('Installation event for unknown integration', { installationId });
    return;
  }

  const repos = payload.repositories ?? [];
  log.info('Auto-discovering repos from installation', { count: repos.length, org: payload.installation.account.login });

  for (const repo of repos) {
    const [owner, name] = repo.full_name.split('/');

    // Upsert repo
    await prisma.repository.upsert({
      where: {
        orgId_provider_providerId: {
          orgId: integration.orgId,
          provider: 'github',
          providerId: String(repo.id),
        },
      },
      create: {
        orgId: integration.orgId,
        provider: 'github',
        providerId: String(repo.id),
        owner,
        name,
        defaultBranch: repo.default_branch ?? 'main',
      },
      update: {
        name,
        defaultBranch: repo.default_branch ?? 'main',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// GitLab integration
// ---------------------------------------------------------------------------

export async function createGitLabIntegration(
  orgId: string,
  accessToken: string,
  baseUrl?: string,
  verifySsl?: boolean,
) {
  const existing = await prisma.integration.findFirst({
    where: { orgId, provider: 'gitlab' },
  });

  if (existing) {
    throw new AppError('INTEGRATION_ALREADY_EXISTS', 'GitLab integration already exists for this organization');
  }

  const config: Record<string, unknown> = { access_token: accessToken };
  if (baseUrl) config.base_url = baseUrl;
  if (verifySsl !== undefined) config.verify_ssl = verifySsl;

  return prisma.integration.create({
    data: {
      orgId,
      provider: 'gitlab',
      status: 'active',
      config,
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook: GitLab push event → trigger scan
// ---------------------------------------------------------------------------

export async function handleGitLabPushEvent(payload: {
  project: { id: number; path_with_namespace: string; default_branch: string };
  ref: string;
}) {
  const providerId = String(payload.project.id);

  const repo = await prisma.repository.findFirst({
    where: { providerId, provider: 'gitlab' },
  });

  if (!repo) {
    log.warn('GitLab push for unknown repository', { providerId });
    return;
  }

  const ref = payload.ref.replace('refs/heads/', '');
  if (ref !== repo.defaultBranch) {
    log.debug('Ignoring GitLab push to non-default branch', { ref });
    return;
  }

  const active = await prisma.scan.findFirst({
    where: { repositoryId: repo.id, status: { in: ['pending', 'running'] } },
  });

  if (active) {
    log.info('Scan already active, skipping', { scanId: active.id });
    return;
  }

  const scan = await prisma.scan.create({
    data: {
      orgId: repo.orgId,
      scanType: 'code_dependencies',
      status: 'pending',
      trigger: 'webhook',
      repositoryId: repo.id,
    },
  });

  await scanOrchestrationQueue.add('scan-repository', {
    scanId: scan.id,
    repositoryId: repo.id,
    orgId: repo.orgId,
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
  });

  log.info('GitLab push scan triggered', { repoId: repo.id, scanId: scan.id });
}

// ---------------------------------------------------------------------------
// Slack integration
// ---------------------------------------------------------------------------

export async function createSlackIntegration(orgId: string, webhookUrl: string) {
  const existing = await prisma.integration.findFirst({
    where: { orgId, provider: 'slack' },
  });

  if (existing) {
    throw new AppError('INTEGRATION_ALREADY_EXISTS', 'Slack integration already exists for this organization');
  }

  return prisma.integration.create({
    data: {
      orgId,
      provider: 'slack',
      status: 'active',
      config: { webhook_url: webhookUrl },
    },
  });
}

// ---------------------------------------------------------------------------
// List integrations
// ---------------------------------------------------------------------------

export async function listIntegrations(orgId: string) {
  return prisma.integration.findMany({
    where: { orgId },
    select: {
      id: true,
      provider: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Delete integration
// ---------------------------------------------------------------------------

export async function deleteIntegration(orgId: string, integrationId: string) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, orgId },
  });

  if (!integration) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Integration not found');
  }

  await prisma.integration.delete({ where: { id: integrationId } });
}
