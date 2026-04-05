import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as serversService from './servers.service.js';
import { ListServersSchema, ServerIdSchema, UpdateServerConfigSchema } from './servers.validation.js';

export const serversRouter = Router();

serversRouter.use(requireAuth);

// GET /servers
serversRouter.get(
  '/',
  requirePermission('view_findings'),
  validate({ query: ListServersSchema }),
  async (req, res, next) => {
    try {
      const result = await serversService.listServers(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);

// GET /servers/:id
serversRouter.get(
  '/:id',
  requirePermission('view_findings'),
  validate({ params: ServerIdSchema }),
  async (req, res, next) => {
    try {
      const server = await serversService.getServerById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(server));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /servers/:id/config — update agent scan/heartbeat settings
serversRouter.patch(
  '/:id/config',
  requirePermission('manage_integrations'),
  validate({ params: ServerIdSchema, body: UpdateServerConfigSchema }),
  async (req, res, next) => {
    try {
      const result = await serversService.updateServerConfig(req.auth!.orgId, req.params.id, req.body);
      res.json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /servers/:id (decommission)
serversRouter.delete(
  '/:id',
  requirePermission('manage_integrations'),
  validate({ params: ServerIdSchema }),
  async (req, res, next) => {
    try {
      const server = await serversService.decommissionServer(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(server));
    } catch (err) {
      next(err);
    }
  },
);
