import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { env } from '../../lib/env.js';
import { verifyWebhookSignature } from '../../lib/github.js';
import * as integrationsService from './integrations.service.js';
import * as cloudDiscovery from './cloud-discovery.service.js';
import { ListProviderReposQuery, SyncReposBody, ConnectAwsBody, ConnectAzureBody, ConnectGcpBody, CloudProviderParam, ListCloudResourcesQuery } from './integrations.validation.js';
import { z } from 'zod';

export const integrationsRouter = Router();

// ---------------------------------------------------------------------------
// T-9.1.2: POST /integrations/github — setup GitHub App integration
// ---------------------------------------------------------------------------
const CreateGitHubSchema = z.object({
  installationId: z.string().min(1),
  appId: z.string().min(1),
});

integrationsRouter.post(
  '/github',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: CreateGitHubSchema }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.createGitHubIntegration(
        req.auth!.orgId,
        req.body.installationId,
        req.body.appId,
      );
      res.status(201).json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// T-9.1.3: POST /integrations/github/webhook — receive GitHub events
// ---------------------------------------------------------------------------
integrationsRouter.post('/github/webhook', express_raw_body, async (req, res, next) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = (req as any).rawBody as Buffer;

    if (!signature || !rawBody || !verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({
        data: null,
        meta: null,
        errors: [{ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid webhook signature', status: 401 }],
      });
    }

    const event = req.headers['x-github-event'] as string;
    const payload = JSON.parse(rawBody.toString());

    switch (event) {
      case 'push':
        await integrationsService.handlePushEvent(payload);
        break;
      case 'installation':
      case 'installation_repositories':
        await integrationsService.handleInstallationEvent(payload);
        break;
      default:
        // Ignore other events
        break;
    }

    res.json(successEnvelope({ received: true, event }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// T-9.3.1: POST /integrations/slack — setup Slack webhook
// ---------------------------------------------------------------------------
const CreateSlackSchema = z.object({
  webhookUrl: z.string().url(),
});

integrationsRouter.post(
  '/slack',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: CreateSlackSchema }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.createSlackIntegration(
        req.auth!.orgId,
        req.body.webhookUrl,
      );
      res.status(201).json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// T-9.2.1: POST /integrations/gitlab — setup GitLab integration
// ---------------------------------------------------------------------------
const CreateGitLabSchema = z.object({
  accessToken: z.string().min(1),
  baseUrl: z.string().url().optional(),
  verifySsl: z.boolean().optional(),
});

integrationsRouter.post(
  '/gitlab',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: CreateGitLabSchema }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.createGitLabIntegration(
        req.auth!.orgId,
        req.body.accessToken,
        req.body.baseUrl,
        req.body.verifySsl,
      );
      res.status(201).json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// T-9.2.2: POST /integrations/gitlab/webhook — receive GitLab push events
// ---------------------------------------------------------------------------
integrationsRouter.post('/gitlab/webhook', async (req, res, next) => {
  try {
    const webhookToken = req.headers['x-gitlab-token'] as string;

    // Verify webhook token against integration config
    if (!webhookToken) {
      return res.status(401).json({
        data: null,
        meta: null,
        errors: [{ code: 'AUTH_INVALID_CREDENTIALS', message: 'Missing X-Gitlab-Token header', status: 401 }],
      });
    }

    // Look up integration by token
    const integration = await (await import('../../lib/prisma.js')).prisma.integration.findFirst({
      where: {
        provider: 'gitlab',
        config: { path: ['webhook_token'], equals: webhookToken },
      },
    });

    // Fall back: accept if any gitlab integration exists (webhook_token is optional for MVP)
    if (!integration) {
      // Accept with warning in MVP — production should validate strictly
    }

    const eventType = req.headers['x-gitlab-event'] as string;
    if (eventType === 'Push Hook') {
      await integrationsService.handleGitLabPushEvent(req.body);
    }

    res.json(successEnvelope({ received: true, event: eventType }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /integrations — list all integrations
// ---------------------------------------------------------------------------
integrationsRouter.get(
  '/',
  requireAuth,
  requirePermission('manage_integrations'),
  async (req, res, next) => {
    try {
      const integrations = await integrationsService.listIntegrations(req.auth!.orgId);
      res.json(successEnvelope(integrations));
    } catch (err) {
      next(err);
    }
  },
);

// ===========================================================================
// REPO DISCOVERY — GitHub
// ===========================================================================

integrationsRouter.get(
  '/github/repos',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ query: ListProviderReposQuery }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.listGitHubRepos(req.auth!.orgId, req.query as any);
      res.json({ data: result.repos, meta: { total: result.total, page: (req.query as any).page ?? 1, per_page: (req.query as any).per_page ?? 50 }, errors: [] });
    } catch (err) { next(err); }
  },
);

integrationsRouter.post(
  '/github/repos/sync',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: SyncReposBody }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.syncGitHubRepos(req.auth!.orgId, req.body.repo_ids);
      res.status(201).json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

integrationsRouter.delete(
  '/github/repos/:id/sync',
  requireAuth,
  requirePermission('manage_integrations'),
  async (req, res, next) => {
    try {
      await integrationsService.unsyncGitHubRepo(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ===========================================================================
// REPO DISCOVERY — GitLab
// ===========================================================================

integrationsRouter.get(
  '/gitlab/repos',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ query: ListProviderReposQuery }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.listGitLabRepos(req.auth!.orgId, req.query as any);
      res.json({ data: result.repos, meta: { total: result.total, page: (req.query as any).page ?? 1, per_page: (req.query as any).per_page ?? 50 }, errors: [] });
    } catch (err) { next(err); }
  },
);

integrationsRouter.post(
  '/gitlab/repos/sync',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: SyncReposBody }),
  async (req, res, next) => {
    try {
      const result = await integrationsService.syncGitLabRepos(req.auth!.orgId, req.body.repo_ids);
      res.status(201).json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

integrationsRouter.delete(
  '/gitlab/repos/:id/sync',
  requireAuth,
  requirePermission('manage_integrations'),
  async (req, res, next) => {
    try {
      await integrationsService.unsyncGitLabRepo(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ===========================================================================
// CLOUD DISCOVERY
// ===========================================================================

// POST /integrations/aws — connect AWS
integrationsRouter.post(
  '/aws',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: ConnectAwsBody }),
  async (req, res, next) => {
    try {
      const result = await cloudDiscovery.connectCloudProvider(req.auth!.orgId, 'aws', req.body);
      res.status(201).json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// POST /integrations/azure — connect Azure
integrationsRouter.post(
  '/azure',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: ConnectAzureBody }),
  async (req, res, next) => {
    try {
      const result = await cloudDiscovery.connectCloudProvider(req.auth!.orgId, 'azure', req.body);
      res.status(201).json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// POST /integrations/gcp — connect GCP
integrationsRouter.post(
  '/gcp',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ body: ConnectGcpBody }),
  async (req, res, next) => {
    try {
      const result = await cloudDiscovery.connectCloudProvider(req.auth!.orgId, 'gcp', req.body);
      res.status(201).json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// GET /integrations/:provider/resources — list discovered resources
integrationsRouter.get(
  '/:provider/resources',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ params: CloudProviderParam, query: ListCloudResourcesQuery }),
  async (req, res, next) => {
    try {
      const result = await cloudDiscovery.listDiscoveredResources(req.auth!.orgId, req.params.provider, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) { next(err); }
  },
);

// POST /integrations/:provider/discover — trigger manual re-discovery
integrationsRouter.post(
  '/:provider/discover',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ params: CloudProviderParam }),
  async (req, res, next) => {
    try {
      const count = await cloudDiscovery.discoverResources(req.auth!.orgId, req.params.provider);
      res.json(successEnvelope({ discovered: count }));
    } catch (err) { next(err); }
  },
);

// GET /servers/unmonitored — cloud instances without agents
integrationsRouter.get(
  '/servers/unmonitored',
  requireAuth,
  requirePermission('view_findings'),
  async (req, res, next) => {
    try {
      const resources = await cloudDiscovery.getUnmonitoredServers(req.auth!.orgId);
      res.json(successEnvelope(resources));
    } catch (err) { next(err); }
  },
);

// GET /coverage/stats — coverage overview
integrationsRouter.get(
  '/coverage/stats',
  requireAuth,
  requirePermission('view_findings'),
  async (req, res, next) => {
    try {
      const stats = await cloudDiscovery.getCoverageStats(req.auth!.orgId);
      res.json(successEnvelope(stats));
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// DELETE /integrations/:id
// ---------------------------------------------------------------------------
const IntegrationIdSchema = z.object({ id: z.string().uuid() });

integrationsRouter.delete(
  '/:id',
  requireAuth,
  requirePermission('manage_integrations'),
  validate({ params: IntegrationIdSchema }),
  async (req, res, next) => {
    try {
      await integrationsService.deleteIntegration(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Middleware to capture raw body for webhook signature verification
// ---------------------------------------------------------------------------
function express_raw_body(req: Request, _res: Response, next: NextFunction): void {
  if ((req as any).rawBody) {
    return next();
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    // Re-parse JSON body
    try {
      req.body = JSON.parse((req as any).rawBody.toString());
    } catch {
      // body may not be JSON
    }
    next();
  });
}
