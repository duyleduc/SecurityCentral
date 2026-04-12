import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { ServerIdParamsSchema, ServerMetricsQuerySchema, UpdateServerSchema } from '../agents/agents.validation.js';
import * as serversService from './servers.service.js';

export const serversRouter = Router();

serversRouter.use(requireAuth);

// GET /api/v1/servers
serversRouter.get('/', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const servers = await serversService.list(req.auth!.orgId);
    res.json(successEnvelope(servers));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/servers/:id
serversRouter.get(
  '/:id',
  requirePermission('view_dashboard'),
  validate({ params: ServerIdParamsSchema }),
  async (req, res, next) => {
    try {
      const server = await serversService.getById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(server));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/servers/:id/metrics
serversRouter.get(
  '/:id/metrics',
  requirePermission('view_dashboard'),
  validate({ params: ServerIdParamsSchema, query: ServerMetricsQuerySchema }),
  async (req, res, next) => {
    try {
      const hours = (req.query as unknown as { hours: number }).hours;
      const metrics = await serversService.getMetrics(req.auth!.orgId, req.params.id, hours);
      res.json(successEnvelope(metrics));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/servers/:id
serversRouter.patch(
  '/:id',
  requirePermission('manage_projects'),
  validate({ params: ServerIdParamsSchema, body: UpdateServerSchema }),
  async (req, res, next) => {
    try {
      const server = await serversService.updateServer(req.auth!.orgId, req.params.id, req.body);
      res.json(successEnvelope(server));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/servers/:id
serversRouter.delete(
  '/:id',
  requirePermission('manage_projects'),
  validate({ params: ServerIdParamsSchema }),
  async (req, res, next) => {
    try {
      const result = await serversService.deleteServer(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/servers/:id/security-posture
serversRouter.get(
  '/:id/security-posture',
  requirePermission('view_dashboard'),
  validate({ params: ServerIdParamsSchema }),
  async (req, res, next) => {
    try {
      const posture = await serversService.getSecurityPosture(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(posture));
    } catch (err) {
      next(err);
    }
  },
);
