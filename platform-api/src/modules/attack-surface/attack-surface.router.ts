import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { ServerIdParamsSchema } from '../agents/agents.validation.js';
import { TriggerScanSchema } from './attack-surface.validation.js';
import * as attackSurfaceService from './attack-surface.service.js';

export const attackSurfaceRouter = Router();

attackSurfaceRouter.use(requireAuth);

// POST /api/v1/servers/:id/attack-surface-scan — trigger scan
attackSurfaceRouter.post(
  '/:id/attack-surface-scan',
  requirePermission('manage_projects'),
  validate({ params: ServerIdParamsSchema, body: TriggerScanSchema }),
  async (req, res, next) => {
    try {
      const result = await attackSurfaceService.triggerScan(req.auth!.orgId, req.params.id, req.body);
      res.json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/servers/:id/attack-surface-scan — latest scan
attackSurfaceRouter.get(
  '/:id/attack-surface-scan',
  requirePermission('view_dashboard'),
  validate({ params: ServerIdParamsSchema }),
  async (req, res, next) => {
    try {
      const scan = await attackSurfaceService.getLatestScan(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(scan));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/servers/:id/attack-surface-scans — scan history
attackSurfaceRouter.get(
  '/:id/attack-surface-scans',
  requirePermission('view_dashboard'),
  validate({ params: ServerIdParamsSchema }),
  async (req, res, next) => {
    try {
      const scans = await attackSurfaceService.listScans(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(scans));
    } catch (err) {
      next(err);
    }
  },
);
