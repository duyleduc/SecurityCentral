import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth, requireScope } from '../../middleware/auth.js';
import { requireMtls } from '../../middleware/mtls.js';
import * as agentsService from './agents.service.js';
import { RegisterAgentSchema, HeartbeatSchema } from './agents.validation.js';

export const agentsRouter = Router();

// ---------------------------------------------------------------------------
// POST /agents/register — authenticated via API key (pre-mTLS)
// ---------------------------------------------------------------------------
agentsRouter.post(
  '/register',
  requireAuth,
  requireScope('scan:write'),
  validate({ body: RegisterAgentSchema }),
  async (req, res, next) => {
    try {
      const result = await agentsService.registerAgent(req.auth!.orgId, req.body);
      res.status(201).json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /agents/heartbeat — authenticated via mTLS
// ---------------------------------------------------------------------------
agentsRouter.post(
  '/heartbeat',
  requireMtls,
  validate({ body: HeartbeatSchema }),
  async (req, res, next) => {
    try {
      // Extract agentId from mTLS CN: ag_<id>.agents.securitycentral.io
      const cn = req.agentCn!;
      const agentId = cn.replace(/^ag_/, '').replace(/\.agents\.securitycentral\.io$/, '');

      const result = await agentsService.processHeartbeat(agentId, req.body);
      res.json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /agents/version — public (no auth required)
// ---------------------------------------------------------------------------
agentsRouter.get('/version', (_req, res) => {
  res.json(successEnvelope(agentsService.getLatestVersion()));
});
