import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { CreateEndpointSchema, UpdateEndpointSchema, EndpointIdParamsSchema, HeartbeatsQuerySchema } from './monitoring.validation.js';
import * as monitoringService from './monitoring.service.js';

export const monitoringRouter = Router();

monitoringRouter.use(requireAuth);

// GET /api/v1/monitoring/endpoints
monitoringRouter.get('/', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const endpoints = await monitoringService.list(req.auth!.orgId);
    res.json(successEnvelope(endpoints));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/monitoring/endpoints
monitoringRouter.post(
  '/',
  requirePermission('manage_endpoints'),
  validate({ body: CreateEndpointSchema }),
  async (req, res, next) => {
    try {
      const endpoint = await monitoringService.create({
        orgId: req.auth!.orgId,
        ...req.body,
      });
      res.status(201).json(successEnvelope(endpoint));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/monitoring/endpoints/:id
monitoringRouter.get(
  '/:id',
  requirePermission('view_dashboard'),
  validate({ params: EndpointIdParamsSchema }),
  async (req, res, next) => {
    try {
      const endpoint = await monitoringService.getById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(endpoint));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/monitoring/endpoints/:id
monitoringRouter.patch(
  '/:id',
  requirePermission('manage_endpoints'),
  validate({ params: EndpointIdParamsSchema, body: UpdateEndpointSchema }),
  async (req, res, next) => {
    try {
      const endpoint = await monitoringService.update(req.auth!.orgId, req.params.id, req.body);
      res.json(successEnvelope(endpoint));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/monitoring/endpoints/:id
monitoringRouter.delete(
  '/:id',
  requirePermission('manage_endpoints'),
  validate({ params: EndpointIdParamsSchema }),
  async (req, res, next) => {
    try {
      await monitoringService.remove(req.auth!.orgId, req.params.id);
      res.json(successEnvelope({ deleted: true }));
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/monitoring/endpoints/:id/check
monitoringRouter.post(
  '/:id/check',
  requirePermission('trigger_scans'),
  validate({ params: EndpointIdParamsSchema }),
  async (req, res, next) => {
    try {
      const result = await monitoringService.triggerCheck(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/monitoring/endpoints/:id/heartbeats
monitoringRouter.get(
  '/:id/heartbeats',
  requirePermission('view_dashboard'),
  validate({ params: EndpointIdParamsSchema, query: HeartbeatsQuerySchema }),
  async (req, res, next) => {
    try {
      const { limit, offset } = req.query as unknown as { limit: number; offset: number };
      const { heartbeats, total } = await monitoringService.getHeartbeats(
        req.auth!.orgId,
        req.params.id,
        limit,
        offset,
      );
      res.json(successEnvelope(heartbeats, { total, limit, offset }));
    } catch (err) {
      next(err);
    }
  },
);
