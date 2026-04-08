import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as findingsService from './findings.service.js';
import {
  ListFindingsSchema,
  FindingIdSchema,
  UpdateFindingSchema,
  StatsQuerySchema,
  TrendsQuerySchema,
} from './findings.validation.js';

export const findingsRouter = Router();

// All findings routes require authentication
findingsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /findings/stats — MUST be before /:id to avoid route collision
// ---------------------------------------------------------------------------
findingsRouter.get(
  '/stats',
  requirePermission('view_findings'),
  validate({ query: StatsQuerySchema }),
  async (req, res, next) => {
    try {
      const stats = await findingsService.getStats(req.auth!.orgId, req.query.source as string | undefined);
      res.json(successEnvelope(stats));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /findings/trends — MUST be before /:id
// ---------------------------------------------------------------------------
findingsRouter.get(
  '/trends',
  requirePermission('view_findings'),
  validate({ query: TrendsQuerySchema }),
  async (req, res, next) => {
    try {
      const trends = await findingsService.getTrends(req.auth!.orgId, req.query as any);
      res.json(successEnvelope(trends));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /findings
// ---------------------------------------------------------------------------
findingsRouter.get(
  '/',
  requirePermission('view_findings'),
  validate({ query: ListFindingsSchema }),
  async (req, res, next) => {
    try {
      const result = await findingsService.listFindings(req.auth!.orgId, req.query as any, req.requestId);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /findings/:id
// ---------------------------------------------------------------------------
findingsRouter.get(
  '/:id',
  requirePermission('view_findings'),
  validate({ params: FindingIdSchema }),
  async (req, res, next) => {
    try {
      const finding = await findingsService.getFindingById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(finding));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /findings/:id
// ---------------------------------------------------------------------------
findingsRouter.patch(
  '/:id',
  requirePermission('update_findings'),
  validate({ params: FindingIdSchema, body: UpdateFindingSchema }),
  async (req, res, next) => {
    try {
      const updated = await findingsService.updateFindingStatus(
        req.auth!.orgId,
        req.params.id,
        req.body.status,
        req.requestId,
      );
      res.json(successEnvelope(updated));
    } catch (err) {
      next(err);
    }
  },
);
