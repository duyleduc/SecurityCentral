import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as monitoringService from './monitoring.service.js';
import { AddEndpointsBody, UpdateEndpointBody, ListEndpointsQuery, EndpointIdParams } from './monitoring.validation.js';

export const monitoringRouter = Router();

monitoringRouter.use(requireAuth);

// POST /monitoring/domains
monitoringRouter.post(
  '/domains',
  requirePermission('manage_integrations'),
  validate({ body: AddEndpointsBody }),
  async (req, res, next) => {
    try {
      const result = await monitoringService.addEndpoints(req.auth!.orgId, req.body);
      res.status(201).json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// GET /monitoring/domains
monitoringRouter.get(
  '/domains',
  requirePermission('view_findings'),
  validate({ query: ListEndpointsQuery }),
  async (req, res, next) => {
    try {
      const result = await monitoringService.listEndpoints(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) { next(err); }
  },
);

// GET /monitoring/domains/:id — detail with heartbeats + uptime stats
monitoringRouter.get(
  '/domains/:id',
  requirePermission('view_findings'),
  validate({ params: EndpointIdParams }),
  async (req, res, next) => {
    try {
      const result = await monitoringService.getEndpointDetail(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// PATCH /monitoring/domains/:id
monitoringRouter.patch(
  '/domains/:id',
  requirePermission('manage_integrations'),
  validate({ params: EndpointIdParams, body: UpdateEndpointBody }),
  async (req, res, next) => {
    try {
      const result = await monitoringService.updateEndpoint(req.auth!.orgId, req.params.id, req.body);
      res.json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// DELETE /monitoring/domains/:id
monitoringRouter.delete(
  '/domains/:id',
  requirePermission('manage_integrations'),
  validate({ params: EndpointIdParams }),
  async (req, res, next) => {
    try {
      await monitoringService.removeEndpoint(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// POST /monitoring/domains/check-all
monitoringRouter.post(
  '/domains/check-all',
  requirePermission('trigger_scans'),
  async (req, res, next) => {
    try {
      const result = await monitoringService.triggerCheckAll(req.auth!.orgId);
      res.json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);

// POST /monitoring/domains/:id/check
monitoringRouter.post(
  '/domains/:id/check',
  requirePermission('trigger_scans'),
  validate({ params: EndpointIdParams }),
  async (req, res, next) => {
    try {
      const result = await monitoringService.triggerCheck(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(result));
    } catch (err) { next(err); }
  },
);
