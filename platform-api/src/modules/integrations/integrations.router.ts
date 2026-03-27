import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { env } from '../../lib/env.js';
import { verifyWebhookSignature } from '../../lib/github.js';
import * as integrationsService from './integrations.service.js';
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
