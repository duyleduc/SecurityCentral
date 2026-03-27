import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errors.js';
import { GitHubClient } from '../../lib/github.js';
import { GitLabClient } from '../../lib/gitlab.js';
import { BitbucketClient } from '../../lib/bitbucket.js';
import { scanOrchestrationQueue } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import type { ListProviderReposQueryType } from './integrations.validation.js';

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

  // Test connection before saving — catches bad tokens, unreachable hosts, SSL issues
  const testClient = new GitLabClient({ accessToken, baseUrl, verifySsl });
  try {
    const version = await testClient.testConnection();
    log.info('GitLab connection verified', { baseUrl: baseUrl ?? 'gitlab.com', version: version.version });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('SSL verification failed')) {
      throw new AppError('VALIDATION_ERROR', `SSL verification failed for ${baseUrl}. Enable "Skip SSL verification" for self-signed certificates.`);
    }
    if (msg.includes('401')) {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 'GitLab access token is invalid or expired');
    }
    throw new AppError('VALIDATION_ERROR', `Cannot connect to GitLab: ${msg}`);
  }

  // Generate a webhook secret for this integration
  const crypto = await import('node:crypto');
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  const config: Record<string, unknown> = {
    access_token: accessToken,
    webhook_secret: webhookSecret,
  };
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

// ===========================================================================
// REPO DISCOVERY — GitHub
// ===========================================================================

interface DiscoveredRepo {
  readonly provider_id: string;
  readonly full_name: string;
  readonly name: string;
  readonly owner: string;
  readonly default_branch: string;
  readonly language: string | null;
  readonly visibility: string;
  readonly updated_at: string;
  readonly synced: boolean;
}

export async function listGitHubRepos(
  orgId: string,
  query: ListProviderReposQueryType,
): Promise<{ repos: DiscoveredRepo[]; total: number }> {
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider: 'github', status: 'active' },
  });
  if (!integration) throw new AppError('RESOURCE_NOT_FOUND', 'No active GitHub integration');

  const config = integration.config as Record<string, string>;
  const gh = await GitHubClient.forInstallation(config.installation_id);

  let allRepos = await gh.listRepositories();

  // Search filter (client-side since GitHub installation API doesn't support search)
  if (query.search) {
    const q = query.search.toLowerCase();
    allRepos = allRepos.filter((r) => r.full_name.toLowerCase().includes(q));
  }

  const total = allRepos.length;

  // Paginate
  const start = (query.page - 1) * query.per_page;
  const pageRepos = allRepos.slice(start, start + query.per_page);

  // Cross-reference with synced repos
  const providerIds = pageRepos.map((r) => String(r.id));
  const syncedRepos = await prisma.repository.findMany({
    where: { orgId, provider: 'github', providerId: { in: providerIds } },
    select: { providerId: true },
  });
  const syncedSet = new Set(syncedRepos.map((r) => r.providerId));

  const repos: DiscoveredRepo[] = pageRepos.map((r) => ({
    provider_id: String(r.id),
    full_name: r.full_name,
    name: r.name,
    owner: r.owner.login,
    default_branch: r.default_branch,
    language: r.language,
    visibility: 'private', // GitHub installation API doesn't expose this directly
    updated_at: '',
    synced: syncedSet.has(String(r.id)),
  }));

  return { repos, total };
}

export async function syncGitHubRepos(orgId: string, repoIds: string[]): Promise<{ synced: number; errors: string[] }> {
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider: 'github', status: 'active' },
  });
  if (!integration) throw new AppError('RESOURCE_NOT_FOUND', 'No active GitHub integration');

  const config = integration.config as Record<string, string>;
  const gh = await GitHubClient.forInstallation(config.installation_id);
  const allRepos = await gh.listRepositories();

  const repoMap = new Map(allRepos.map((r) => [String(r.id), r]));

  let synced = 0;
  const errors: string[] = [];

  for (const repoId of repoIds) {
    const repo = repoMap.get(repoId);
    if (!repo) {
      errors.push(`Repo ${repoId} not found in GitHub installation`);
      continue;
    }

    try {
      await prisma.repository.upsert({
        where: {
          orgId_provider_providerId: { orgId, provider: 'github', providerId: repoId },
        },
        create: {
          orgId,
          provider: 'github',
          providerId: repoId,
          owner: repo.owner.login,
          name: repo.name,
          defaultBranch: repo.default_branch,
          language: repo.language,
        },
        update: {
          name: repo.name,
          defaultBranch: repo.default_branch,
          language: repo.language,
        },
      });
      synced++;
    } catch (err) {
      errors.push(`Failed to sync ${repo.full_name}: ${(err as Error).message}`);
    }
  }

  log.info('GitHub repos synced', { orgId, synced, errors: errors.length });
  return { synced, errors };
}

export async function unsyncGitHubRepo(orgId: string, providerId: string): Promise<void> {
  const repo = await prisma.repository.findFirst({
    where: { orgId, provider: 'github', providerId },
  });

  if (!repo) throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');

  // Soft archive: update settings to mark as archived, preserve data
  await prisma.repository.update({
    where: { id: repo.id },
    data: { settings: { archived: true, unsyncedAt: new Date().toISOString() } },
  });

  log.info('GitHub repo unsynced', { orgId, repoId: repo.id, providerId });
}

// ===========================================================================
// REPO DISCOVERY — GitLab
// ===========================================================================

export async function listGitLabRepos(
  orgId: string,
  query: ListProviderReposQueryType,
): Promise<{ repos: DiscoveredRepo[]; total: number }> {
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider: 'gitlab', status: 'active' },
  });
  if (!integration) throw new AppError('RESOURCE_NOT_FOUND', 'No active GitLab integration');

  const config = integration.config as Record<string, string>;
  const gl = new GitLabClient({
    accessToken: config.access_token,
    baseUrl: config.base_url,
    verifySsl: config.verify_ssl !== 'false',
  });

  let result;
  try {
    result = await gl.listProjects({
      search: query.search,
      page: query.page,
      per_page: query.per_page,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('401')) {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 'GitLab access token is invalid or expired. Reconnect the integration.');
    }
    if (msg.includes('SSL') || msg.includes('UNABLE_TO_VERIFY')) {
      throw new AppError('VALIDATION_ERROR', 'SSL connection failed. Enable "Skip SSL verification" in integration settings.');
    }
    throw new AppError('VALIDATION_ERROR', `Cannot connect to GitLab: ${msg}`);
  }

  // Cross-reference with synced repos
  const providerIds = result.projects.map((p) => String(p.id));
  const syncedRepos = await prisma.repository.findMany({
    where: { orgId, provider: 'gitlab', providerId: { in: providerIds } },
    select: { providerId: true },
  });
  const syncedSet = new Set(syncedRepos.map((r) => r.providerId));

  const repos: DiscoveredRepo[] = result.projects.map((p) => ({
    provider_id: String(p.id),
    full_name: p.path_with_namespace,
    name: p.name,
    owner: p.namespace.full_path,
    default_branch: p.default_branch,
    language: null, // GitLab doesn't return language in list; separate call needed
    visibility: p.visibility,
    updated_at: p.last_activity_at,
    synced: syncedSet.has(String(p.id)),
  }));

  return { repos, total: result.total };
}

export async function syncGitLabRepos(orgId: string, repoIds: string[]): Promise<{ synced: number; errors: string[] }> {
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider: 'gitlab', status: 'active' },
  });
  if (!integration) throw new AppError('RESOURCE_NOT_FOUND', 'No active GitLab integration');

  const config = integration.config as Record<string, string>;
  const gl = new GitLabClient({
    accessToken: config.access_token,
    baseUrl: config.base_url,
    verifySsl: config.verify_ssl !== 'false',
  });

  let synced = 0;
  const errors: string[] = [];

  for (const repoId of repoIds) {
    try {
      const project = await gl.getProject(parseInt(repoId, 10));
      const [owner, ...nameParts] = project.path_with_namespace.split('/');
      const name = nameParts.join('/');

      await prisma.repository.upsert({
        where: {
          orgId_provider_providerId: { orgId, provider: 'gitlab', providerId: repoId },
        },
        create: {
          orgId,
          provider: 'gitlab',
          providerId: repoId,
          owner,
          name,
          defaultBranch: project.default_branch,
        },
        update: {
          name,
          defaultBranch: project.default_branch,
        },
      });

      // Configure webhook
      const webhookUrl = `${process.env.PLATFORM_URL ?? 'https://api.securitycentral.io'}/api/v1/integrations/gitlab/webhook`;
      try {
        await gl.createWebhook(parseInt(repoId, 10), webhookUrl, config.access_token);
      } catch {
        // Webhook may already exist — non-fatal
      }

      synced++;
    } catch (err) {
      errors.push(`Failed to sync project ${repoId}: ${(err as Error).message}`);
    }
  }

  log.info('GitLab repos synced', { orgId, synced, errors: errors.length });
  return { synced, errors };
}

export async function unsyncGitLabRepo(orgId: string, providerId: string): Promise<void> {
  const repo = await prisma.repository.findFirst({
    where: { orgId, provider: 'gitlab', providerId },
  });

  if (!repo) throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');

  // Try to remove webhook (best-effort)
  const integration = await prisma.integration.findFirst({
    where: { orgId, provider: 'gitlab', status: 'active' },
  });

  if (integration) {
    const config = integration.config as Record<string, string>;
    const gl = new GitLabClient({
      accessToken: config.access_token,
      baseUrl: config.base_url,
    });

    try {
      const hooks = await gl.listWebhooks(parseInt(providerId, 10));
      for (const hook of hooks) {
        if (hook.url.includes('securitycentral')) {
          await gl.deleteWebhook(parseInt(providerId, 10), hook.id);
        }
      }
    } catch {
      // Non-fatal — webhook cleanup is best-effort
    }
  }

  await prisma.repository.update({
    where: { id: repo.id },
    data: { settings: { archived: true, unsyncedAt: new Date().toISOString() } },
  });

  log.info('GitLab repo unsynced', { orgId, repoId: repo.id, providerId });
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

// ===========================================================================
// REPO DISCOVERY — Bitbucket
// ===========================================================================

export async function createBitbucketIntegration(orgId: string, workspace: string, username: string, appPassword: string, baseUrl?: string) {
  const existing = await prisma.integration.findFirst({ where: { orgId, provider: 'bitbucket' } });
  if (existing) throw new AppError('INTEGRATION_ALREADY_EXISTS', 'Bitbucket integration already exists');

  const config: Record<string, unknown> = { workspace, username, app_password: appPassword };
  if (baseUrl) config.base_url = baseUrl;

  return prisma.integration.create({ data: { orgId, provider: 'bitbucket', status: 'active', config } });
}

export async function listBitbucketRepos(orgId: string, query: ListProviderReposQueryType) {
  const integration = await prisma.integration.findFirst({ where: { orgId, provider: 'bitbucket', status: 'active' } });
  if (!integration) throw new AppError('RESOURCE_NOT_FOUND', 'No active Bitbucket integration');

  const config = integration.config as Record<string, string>;
  const bb = new BitbucketClient({ username: config.username, appPassword: config.app_password, workspace: config.workspace, baseUrl: config.base_url });

  let repos = await bb.listRepositories();
  if (query.search) {
    const q = query.search.toLowerCase();
    repos = repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }

  const total = repos.length;
  const start = (query.page - 1) * query.per_page;
  const page = repos.slice(start, start + query.per_page);

  const providerIds = page.map((r) => r.uuid);
  const synced = await prisma.repository.findMany({ where: { orgId, provider: 'bitbucket', providerId: { in: providerIds } }, select: { providerId: true } });
  const syncedSet = new Set(synced.map((r) => r.providerId));

  return {
    repos: page.map((r) => ({
      provider_id: r.uuid,
      full_name: r.full_name,
      name: r.name,
      owner: config.workspace,
      default_branch: r.mainbranch?.name ?? 'main',
      language: r.language || null,
      visibility: r.is_private ? 'private' : 'public',
      updated_at: r.updated_on,
      synced: syncedSet.has(r.uuid),
    })),
    total,
  };
}

export async function syncBitbucketRepos(orgId: string, repoIds: string[]) {
  const integration = await prisma.integration.findFirst({ where: { orgId, provider: 'bitbucket', status: 'active' } });
  if (!integration) throw new AppError('RESOURCE_NOT_FOUND', 'No active Bitbucket integration');

  const config = integration.config as Record<string, string>;
  const bb = new BitbucketClient({ username: config.username, appPassword: config.app_password, workspace: config.workspace, baseUrl: config.base_url });
  const allRepos = await bb.listRepositories();
  const repoMap = new Map(allRepos.map((r) => [r.uuid, r]));

  let synced = 0;
  const errors: string[] = [];

  for (const id of repoIds) {
    const repo = repoMap.get(id);
    if (!repo) { errors.push(`Repo ${id} not found`); continue; }

    try {
      await prisma.repository.upsert({
        where: { orgId_provider_providerId: { orgId, provider: 'bitbucket', providerId: id } },
        create: { orgId, provider: 'bitbucket', providerId: id, owner: config.workspace, name: repo.name, defaultBranch: repo.mainbranch?.name ?? 'main', language: repo.language || null },
        update: { name: repo.name, defaultBranch: repo.mainbranch?.name ?? 'main' },
      });
      synced++;
    } catch (err) { errors.push(`${repo.full_name}: ${(err as Error).message}`); }
  }

  return { synced, errors };
}

export async function unsyncBitbucketRepo(orgId: string, providerId: string) {
  const repo = await prisma.repository.findFirst({ where: { orgId, provider: 'bitbucket', providerId } });
  if (!repo) throw new AppError('RESOURCE_NOT_FOUND', 'Repository not found');
  await prisma.repository.update({ where: { id: repo.id }, data: { settings: { archived: true, unsyncedAt: new Date().toISOString() } } });
}

export async function handleBitbucketPushEvent(payload: { repository: { uuid: string; full_name: string }; push?: { changes: unknown[] } }) {
  const providerId = payload.repository.uuid;
  const repo = await prisma.repository.findFirst({ where: { providerId, provider: 'bitbucket' } });
  if (!repo) return;

  const active = await prisma.scan.findFirst({ where: { repositoryId: repo.id, status: { in: ['pending', 'running'] } } });
  if (active) return;

  const scan = await prisma.scan.create({ data: { orgId: repo.orgId, scanType: 'code_dependencies', status: 'pending', trigger: 'webhook', repositoryId: repo.id } });
  await scanOrchestrationQueue.add('scan-repository', { scanId: scan.id, repositoryId: repo.id, orgId: repo.orgId }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100 });
  log.info('Bitbucket push scan triggered', { repoId: repo.id, scanId: scan.id });
}

export async function deleteIntegration(orgId: string, integrationId: string) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, orgId },
  });

  if (!integration) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Integration not found');
  }

  await prisma.integration.delete({ where: { id: integrationId } });
}
