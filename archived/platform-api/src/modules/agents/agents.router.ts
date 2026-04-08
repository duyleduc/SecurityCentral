import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth, requireScope } from '../../middleware/auth.js';
import { requireMtls } from '../../middleware/mtls.js';
import * as agentsService from './agents.service.js';
import { RegisterAgentSchema, HeartbeatSchema, SubmitFindingsSchema } from './agents.validation.js';
import { EnrollAgentSchema } from './install-tokens.validation.js';
import { redeemInstallToken } from './install-tokens.service.js';
import { ingestFindings } from './findings-ingestion.service.js';
import * as vulndbService from './vulndb.service.js';

export const agentsRouter = Router();

// Resolve local agent binary directory.
// process.cwd() is the platform-api/ dir when started via Makefile/tsx.
// The project root is one level up.
function agentBinDir(): string {
  return path.join(process.cwd(), '..', 'go', 'bin');
}

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
// POST /agents/enroll — authenticated via one-time install token
// ---------------------------------------------------------------------------
agentsRouter.post(
  '/enroll',
  validate({ body: EnrollAgentSchema }),
  async (req, res, next) => {
    try {
      const result = await redeemInstallToken(req.body);
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
// POST /agents/findings — authenticated via mTLS
// ---------------------------------------------------------------------------
agentsRouter.post(
  '/findings',
  requireMtls,
  validate({ body: SubmitFindingsSchema }),
  async (req, res, next) => {
    try {
      const cn = req.agentCn!;
      const agentId = cn.replace(/^ag_/, '').replace(/\.agents\.securitycentral\.io$/, '');

      // Resolve org from agent's server record
      const server = await import('../../lib/prisma.js').then((m) =>
        m.prisma.server.findFirst({ where: { agentId }, select: { orgId: true } }),
      );

      if (!server) {
        return res.status(404).json({
          data: null,
          meta: null,
          errors: [{ code: 'RESOURCE_NOT_FOUND', message: 'Agent not registered', status: 404 }],
        });
      }

      const result = await ingestFindings(server.orgId, req.body, req.requestId);
      res.status(201).json(successEnvelope(result));
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

// ---------------------------------------------------------------------------
// GET /agents/download — serve agent binary (no auth)
// ---------------------------------------------------------------------------
agentsRouter.get('/download', (req, res) => {
  const arch = req.query.arch === 'arm64' ? 'arm64' : 'amd64';
  const localBinary = path.join(agentBinDir(), `sc-agent-linux-${arch}`);

  if (fs.existsSync(localBinary)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="sc-agent"');
    return res.sendFile(localBinary);
  }

  const { platforms } = agentsService.getLatestVersion();
  res.redirect(302, platforms[`linux/${arch}` as keyof typeof platforms]);
});

// ---------------------------------------------------------------------------
// GET /agents/download/checksum — serve .sha256 file (no auth)
// ---------------------------------------------------------------------------
agentsRouter.get('/download/checksum', (req, res) => {
  const arch = req.query.arch === 'arm64' ? 'arm64' : 'amd64';
  const checksumFile = path.join(agentBinDir(), `sc-agent-linux-${arch}.sha256`);

  if (fs.existsSync(checksumFile)) {
    res.setHeader('Content-Type', 'text/plain');
    return res.sendFile(checksumFile);
  }

  res.status(404).json({ data: null, meta: null, errors: [{ code: 'NOT_FOUND', message: 'Checksum not available (unsigned build)', status: 404 }] });
});

// ---------------------------------------------------------------------------
// GET /agents/download/signature — serve .sig file (no auth)
// ---------------------------------------------------------------------------
agentsRouter.get('/download/signature', (req, res) => {
  const arch = req.query.arch === 'arm64' ? 'arm64' : 'amd64';
  const sigFile = path.join(agentBinDir(), `sc-agent-linux-${arch}.sig`);

  if (fs.existsSync(sigFile)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="sc-agent.sig"`);
    return res.sendFile(sigFile);
  }

  res.status(404).json({ data: null, meta: null, errors: [{ code: 'NOT_FOUND', message: 'Signature not available (unsigned build)', status: 404 }] });
});

// ---------------------------------------------------------------------------
// GET /agents/vulndb/version — mTLS authenticated
// ---------------------------------------------------------------------------
agentsRouter.get('/vulndb/version', requireMtls, async (_req, res, next) => {
  try {
    const version = await vulndbService.getSnapshotVersion();
    res.json(successEnvelope({ version }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /agents/vulndb/download — mTLS authenticated
// ---------------------------------------------------------------------------
agentsRouter.get('/vulndb/download', requireMtls, async (req, res, next) => {
  try {
    const since = req.query.since as string | undefined;
    const result = await vulndbService.downloadSnapshot(since);
    res.json(successEnvelope(result));
  } catch (err) {
    next(err);
  }
});
