import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as scansService from './scans.service.js';
import { ListScansSchema, ScanIdSchema } from './scans.validation.js';

export const scansRouter = Router();

scansRouter.use(requireAuth);

// GET /scans
scansRouter.get(
  '/',
  requirePermission('view_findings'),
  validate({ query: ListScansSchema }),
  async (req, res, next) => {
    try {
      const result = await scansService.listScans(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);

// GET /scans/:id
scansRouter.get(
  '/:id',
  requirePermission('view_findings'),
  validate({ params: ScanIdSchema }),
  async (req, res, next) => {
    try {
      const scan = await scansService.getScanById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(scan));
    } catch (err) {
      next(err);
    }
  },
);

// POST /scans/:id/cancel
scansRouter.post(
  '/:id/cancel',
  requirePermission('trigger_scans'),
  validate({ params: ScanIdSchema }),
  async (req, res, next) => {
    try {
      const scan = await scansService.cancelScan(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(scan));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /scans/:id
scansRouter.delete(
  '/:id',
  requirePermission('trigger_scans'),
  validate({ params: ScanIdSchema }),
  async (req, res, next) => {
    try {
      await scansService.deleteScan(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
