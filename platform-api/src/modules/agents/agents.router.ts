import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  CreateInstallTokenSchema,
  AgentRegisterSchema,
  AgentHeartbeatSchema,
  AgentFindingsSchema,
} from './agents.validation.js';
import * as agentsService from './agents.service.js';

export const installTokensRouter = Router();
export const agentRouter = Router();

// ---------------------------------------------------------------------------
// Install Tokens (authenticated user routes)
// ---------------------------------------------------------------------------

installTokensRouter.use(requireAuth);

// POST /api/v1/install-tokens
installTokensRouter.post(
  '/',
  requirePermission('manage_projects'),
  validate({ body: CreateInstallTokenSchema }),
  async (req, res, next) => {
    try {
      const token = await agentsService.createInstallToken({
        orgId: req.auth!.orgId,
        ...req.body,
      });
      res.status(201).json(successEnvelope(token));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/install-tokens
installTokensRouter.get('/', requirePermission('manage_projects'), async (req, res, next) => {
  try {
    const tokens = await agentsService.listInstallTokens(req.auth!.orgId);
    res.json(successEnvelope(tokens));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Agent Routes (no JWT auth — agents use their own key or install token)
// ---------------------------------------------------------------------------

// POST /v1/agents/register
agentRouter.post('/register', validate({ body: AgentRegisterSchema }), async (req, res, next) => {
  try {
    const result = await agentsService.registerAgent(req.body);
    res.status(201).json(successEnvelope(result));
  } catch (err) {
    next(err);
  }
});

// POST /v1/agents/heartbeat
agentRouter.post('/heartbeat', validate({ body: AgentHeartbeatSchema }), async (req, res, next) => {
  try {
    const result = await agentsService.processHeartbeat(req.body);
    res.json(successEnvelope(result));
  } catch (err) {
    next(err);
  }
});

// POST /v1/agents/findings
agentRouter.post('/findings', validate({ body: AgentFindingsSchema }), async (req, res, next) => {
  try {
    const result = await agentsService.ingestFindings(req.body);
    res.json(successEnvelope(result));
  } catch (err) {
    next(err);
  }
});
