import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as findingsService from './findings.service.js';
import { FindingIdParamsSchema, FindingsListQuerySchema, UpdateFindingSchema } from './findings.validation.js';

export const findingsRouter = Router();
findingsRouter.use(requireAuth);

// GET /api/v1/findings
findingsRouter.get(
  '/',
  requirePermission('view_findings'),
  validate({ query: FindingsListQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await findingsService.list({
        orgId: req.auth!.orgId,
        severity: req.query.severity as string | undefined,
        status: req.query.status as string | undefined,
        source: req.query.source as string | undefined,
        repositoryId: req.query.repositoryId as string | undefined,
        serverId: req.query.serverId as string | undefined,
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 20),
      });
      res.json(successEnvelope(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }));
    } catch (err) { next(err); }
  },
);

// GET /api/v1/findings/:id
findingsRouter.get(
  '/:id',
  requirePermission('view_findings'),
  validate({ params: FindingIdParamsSchema }),
  async (req, res, next) => {
    try {
      const finding = await findingsService.getById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(finding));
    } catch (err) { next(err); }
  },
);

// PATCH /api/v1/findings/:id
findingsRouter.patch(
  '/:id',
  requirePermission('update_findings'),
  validate({ params: FindingIdParamsSchema, body: UpdateFindingSchema }),
  async (req, res, next) => {
    try {
      const finding = await findingsService.updateStatus(req.auth!.orgId, req.params.id, req.body.status);
      res.json(successEnvelope(finding));
    } catch (err) { next(err); }
  },
);
