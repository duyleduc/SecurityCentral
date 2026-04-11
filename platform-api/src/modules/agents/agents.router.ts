import { Router } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { logger } from '../../lib/logger.js';
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

// GET /v1/agents/download?arch=amd64|arm64 — serve Linux agent binary (no auth)
agentRouter.get('/download', (req, res) => {
  const arch = req.query.arch === 'arm64' ? 'arm64' : 'amd64';
  const binaryName = `sc-agent-linux-${arch}`;
  const binaryPath = resolve(process.cwd(), '..', 'sc-agent', 'bin', binaryName);

  if (!existsSync(binaryPath)) {
    logger.warn('agent binary not found', { arch, binaryPath });
    res.status(404).json({ error: `Linux binary not found for ${arch}. Build with: cd sc-agent && GOOS=linux GOARCH=${arch} go build -o bin/${binaryName} ./cmd/sc-agent` });
    return;
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="sc-agent"');
  createReadStream(binaryPath).pipe(res);
});

// POST /v1/agents/register
agentRouter.post('/register', validate({ body: AgentRegisterSchema }), async (req, res, next) => {
  try {
    const result = await agentsService.registerAgent(req.body);
    res.status(201).json(successEnvelope(result));
  } catch (err) {
    next(err);
  }
});

// POST /v1/agents/enroll — v1 compatibility (accepts extra fields like csr, arch, cloud*)
agentRouter.post('/enroll', async (req, res, next) => {
  try {
    const result = await agentsService.registerAgent({
      token: req.body.token,
      hostname: req.body.hostname,
      osFamily: req.body.osFamily,
      osVersion: req.body.osVersion,
      agentVersion: req.body.agentVersion,
    });
    // Return v1-shaped response (agentId + dummy cert fields)
    res.status(201).json({
      data: {
        agentId: result.agentId,
        signedCert: '',
        caCert: '',
        config: {
          environment: 'production',
          labels: {},
          scan: { packages: true, compliance: true, interval: '6h', onStartup: true },
        },
      },
      errors: [],
    });
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
