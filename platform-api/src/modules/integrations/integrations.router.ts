import { Router, raw } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope, AppError } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../lib/env.js';
import * as github from '../../lib/github.js';
import * as gitlab from '../../lib/gitlab.js';
import * as integrationsService from './integrations.service.js';
import * as scannerService from '../scanner/scanner.service.js';
import {
  IntegrationIdParamsSchema,
  ProviderParamsSchema,
  ConnectGitHubSchema,
  ConnectGitHubPatSchema,
  ConnectGitLabSchema,
  SyncReposSchema,
  RepoListQuerySchema,
} from './integrations.validation.js';

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

// GET /api/v1/integrations
integrationsRouter.get('/', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const list = await integrationsService.list(req.auth!.orgId);
    res.json(successEnvelope(list));
  } catch (err) { next(err); }
});

// DELETE /api/v1/integrations/:id
integrationsRouter.delete(
  '/:id',
  requirePermission('manage_integrations'),
  validate({ params: IntegrationIdParamsSchema }),
  async (req, res, next) => {
    try {
      await integrationsService.remove(req.auth!.orgId, req.params.id);
      res.json(successEnvelope({ deleted: true }));
    } catch (err) { next(err); }
  },
);

// POST /api/v1/integrations/github — GitHub App installation (advanced)
integrationsRouter.post(
  '/github',
  requirePermission('manage_integrations'),
  validate({ body: ConnectGitHubSchema }),
  async (req, res, next) => {
    try {
      const integration = await integrationsService.connectGitHub({
        orgId: req.auth!.orgId,
        installationId: req.body.installationId,
        appId: req.body.appId,
      });
      res.status(201).json(successEnvelope(integration));
    } catch (err) { next(err); }
  },
);

// POST /api/v1/integrations/github/pat — Personal Access Token (recommended for SMEs)
integrationsRouter.post(
  '/github/pat',
  requirePermission('manage_integrations'),
  validate({ body: ConnectGitHubPatSchema }),
  async (req, res, next) => {
    try {
      const verified = await github.verifyPersonalToken(req.body.accessToken, req.body.baseUrl);
      if (!verified.valid) {
        throw new AppError('AUTH_INVALID_CREDENTIALS', verified.message ?? 'Invalid GitHub token');
      }
      const integration = await integrationsService.connectGitHubPat({
        orgId: req.auth!.orgId,
        accessToken: req.body.accessToken,
        baseUrl: req.body.baseUrl,
        verifySsl: req.body.verifySsl,
      });
      res.status(201).json(successEnvelope({
        ...integration,
        login: verified.login,
        scopes: verified.scopes,
      }));
    } catch (err) { next(err); }
  },
);

// POST /api/v1/integrations/gitlab
integrationsRouter.post(
  '/gitlab',
  requirePermission('manage_integrations'),
  validate({ body: ConnectGitLabSchema }),
  async (req, res, next) => {
    try {
      const verified = await gitlab.verifyToken(
        req.body.accessToken,
        req.body.baseUrl,
        req.body.verifySsl,
      );
      if (!verified.valid) {
        throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid GitLab access token');
      }
      const integration = await integrationsService.connectGitLab({
        orgId: req.auth!.orgId,
        accessToken: req.body.accessToken,
        baseUrl: req.body.baseUrl,
        verifySsl: req.body.verifySsl,
      });
      res.status(201).json(successEnvelope(integration));
    } catch (err) { next(err); }
  },
);

// GET /api/v1/integrations/github/repos — dispatches based on stored config
integrationsRouter.get(
  '/github/repos',
  requirePermission('manage_integrations'),
  validate({ query: RepoListQuerySchema }),
  async (req, res, next) => {
    try {
      const integration = await integrationsService.getIntegrationByProvider(req.auth!.orgId, 'github');
      if (!integration) {
        throw new AppError('RESOURCE_NOT_FOUND', 'GitHub integration not found');
      }
      const config = integration.config as { accessToken?: string; installationId?: string; appId?: string };
      const page = Number(req.query.page ?? 1);
      const perPage = Number(req.query.perPage ?? 30);
      const search = req.query.search as string | undefined;

      // Personal Access Token path (simpler, recommended for SMEs)
      if (config.accessToken) {
        const result = await github.listUserRepos(
          config.accessToken,
          page,
          perPage,
          search,
          integration.baseUrl ?? undefined,
        );
        return res.json(successEnvelope(result));
      }

      // GitHub App installation path
      if (config.installationId) {
        const { token } = await github.getInstallationToken(
          config.installationId,
          config.appId ?? env.GITHUB_APP_ID,
          env.GITHUB_APP_PRIVATE_KEY,
          integration.baseUrl ?? undefined,
        );
        const result = await github.listInstallationRepos(
          token,
          page,
          perPage,
          integration.baseUrl ?? undefined,
        );
        return res.json(successEnvelope(result));
      }

      throw new AppError('VALIDATION_ERROR', 'GitHub integration has no usable credentials');
    } catch (err) { next(err); }
  },
);

// GET /api/v1/integrations/gitlab/repos
integrationsRouter.get(
  '/gitlab/repos',
  requirePermission('manage_integrations'),
  validate({ query: RepoListQuerySchema }),
  async (req, res, next) => {
    try {
      const integration = await integrationsService.getIntegrationByProvider(req.auth!.orgId, 'gitlab');
      if (!integration) {
        throw new AppError('RESOURCE_NOT_FOUND', 'GitLab integration not found');
      }
      const config = integration.config as { accessToken: string };
      const result = await gitlab.listProjects(
        config.accessToken,
        Number(req.query.page ?? 1),
        Number(req.query.perPage ?? 30),
        req.query.search as string | undefined,
        integration.baseUrl ?? undefined,
        integration.verifySsl,
      );
      res.json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// POST /api/v1/integrations/:provider/repos/sync
integrationsRouter.post(
  '/:provider/repos/sync',
  requirePermission('manage_integrations'),
  validate({ params: ProviderParamsSchema, body: SyncReposSchema }),
  async (req, res, next) => {
    try {
      const repos = await integrationsService.syncRepos(
        req.auth!.orgId,
        req.params.provider,
        req.body.repos.map((r: any) => ({ ...r, providerId: String(r.providerId) })),
        req.body.projectId,
      );
      res.status(201).json(successEnvelope(repos));
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// Webhook routes (public — no auth middleware, signature-verified)
// ---------------------------------------------------------------------------

export const webhookRouter = Router();

// POST /api/v1/integrations/github/webhook
webhookRouter.post('/github/webhook', raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string | undefined;

    if (!signature || !event) {
      return res.status(400).json({ error: 'Missing signature or event header' });
    }

    const payload = typeof req.body === 'string' ? req.body : req.body.toString('utf8');

    // Find the integration by verifying signature against all GitHub integrations
    const integrations = await findGitHubIntegrationBySignature(payload, signature);
    if (!integrations) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    if (event === 'push') {
      await handleGitHubPush(integrations.orgId, payload);
    }

    res.json({ received: true });
  } catch (err) { next(err); }
});

// POST /api/v1/integrations/gitlab/webhook
webhookRouter.post('/gitlab/webhook', async (req, res, next) => {
  try {
    const token = req.headers['x-gitlab-token'] as string | undefined;
    if (!token) {
      return res.status(400).json({ error: 'Missing X-Gitlab-Token header' });
    }

    const integration = await integrationsService.findIntegrationByWebhookSecret('gitlab', token);
    if (!integration) {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const event = req.headers['x-gitlab-event'] as string | undefined;
    if (event === 'Push Hook') {
      await handleGitLabPush(integration.orgId, req.body);
    }

    res.json({ received: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Webhook handlers
// ---------------------------------------------------------------------------

async function findGitHubIntegrationBySignature(payload: string, signature: string) {
  // Check all GitHub integrations for a matching signature
  const integrations = await prisma_findAllGitHub();
  for (const i of integrations) {
    if (i.webhookSecret && github.verifyWebhookSignature(payload, signature, i.webhookSecret)) {
      return i;
    }
  }
  return null;
}

async function prisma_findAllGitHub() {
  const { prisma } = await import('../../lib/prisma.js');
  return prisma.integration.findMany({
    where: { provider: 'github', enabled: true },
    select: { id: true, orgId: true, webhookSecret: true, config: true, baseUrl: true },
  });
}

async function handleGitHubPush(orgId: string, rawPayload: string) {
  const payload = JSON.parse(rawPayload);
  const repoFullName = payload.repository?.full_name as string | undefined;
  if (!repoFullName) return;

  const [owner, name] = repoFullName.split('/');
  const repo = await integrationsService.findRepoByProviderAndName(orgId, 'github', owner, name);
  if (!repo) {
    logger.info('webhook push for untracked repo', { orgId, repoFullName });
    return;
  }

  const ref = payload.ref as string; // refs/heads/branch-name
  const branch = ref.replace('refs/heads/', '');
  const isDefaultBranch = branch === repo.defaultBranch;

  logger.info('github push webhook', { repo: repoFullName, branch, isDefaultBranch });

  // Trigger scan in background (fire-and-forget)
  scannerService.triggerScan({
    orgId,
    repositoryId: repo.id,
    trigger: 'webhook',
    branch,
    fullScan: isDefaultBranch,
  }).catch((err) => logger.error('webhook scan trigger failed', { error: err }));
}

async function handleGitLabPush(orgId: string, payload: any) {
  const projectPath = payload.project?.path_with_namespace as string | undefined;
  if (!projectPath) return;

  const parts = projectPath.split('/');
  const name = parts.pop()!;
  const owner = parts.join('/');

  const repo = await integrationsService.findRepoByProviderAndName(orgId, 'gitlab', owner, name);
  if (!repo) {
    logger.info('webhook push for untracked repo', { orgId, projectPath });
    return;
  }

  const ref = payload.ref as string;
  const branch = ref.replace('refs/heads/', '');
  const isDefaultBranch = branch === repo.defaultBranch;

  logger.info('gitlab push webhook', { repo: projectPath, branch, isDefaultBranch });

  scannerService.triggerScan({
    orgId,
    repositoryId: repo.id,
    trigger: 'webhook',
    branch,
    fullScan: isDefaultBranch,
  }).catch((err) => logger.error('webhook scan trigger failed', { error: err }));
}
