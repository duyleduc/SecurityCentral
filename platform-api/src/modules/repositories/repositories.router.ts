import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as reposService from './repositories.service.js';
import * as scannerService from '../scanner/scanner.service.js';
import {
  RepositoryIdParamsSchema,
  RepositoryListQuerySchema,
  TriggerScanSchema,
  ScanHistoryQuerySchema,
} from './repositories.validation.js';

export const repositoriesRouter = Router();
repositoriesRouter.use(requireAuth);

// GET /api/v1/repositories
repositoriesRouter.get(
  '/',
  requirePermission('view_dashboard'),
  validate({ query: RepositoryListQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await reposService.list({
        orgId: req.auth!.orgId,
        projectId: req.query.projectId as string | undefined,
        provider: req.query.provider as string | undefined,
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

// GET /api/v1/repositories/:id
repositoriesRouter.get(
  '/:id',
  requirePermission('view_dashboard'),
  validate({ params: RepositoryIdParamsSchema }),
  async (req, res, next) => {
    try {
      const repo = await reposService.getById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(repo));
    } catch (err) { next(err); }
  },
);

// DELETE /api/v1/repositories/:id
repositoriesRouter.delete(
  '/:id',
  requirePermission('manage_integrations'),
  validate({ params: RepositoryIdParamsSchema }),
  async (req, res, next) => {
    try {
      await reposService.remove(req.auth!.orgId, req.params.id);
      res.json(successEnvelope({ deleted: true }));
    } catch (err) { next(err); }
  },
);

// POST /api/v1/repositories/:id/scan
repositoriesRouter.post(
  '/:id/scan',
  requirePermission('manage_integrations'),
  validate({ params: RepositoryIdParamsSchema, body: TriggerScanSchema }),
  async (req, res, next) => {
    try {
      const repo = await reposService.getById(req.auth!.orgId, req.params.id);
      const scan = await scannerService.triggerScan({
        orgId: req.auth!.orgId,
        repositoryId: repo.id,
        trigger: 'manual',
        branch: req.body.branch,
        fullScan: true,
        scanType: req.body.scanType,
      });
      res.status(201).json(successEnvelope(scan));
    } catch (err) { next(err); }
  },
);

// GET /api/v1/repositories/:id/scans
repositoriesRouter.get(
  '/:id/scans',
  requirePermission('view_dashboard'),
  validate({ params: RepositoryIdParamsSchema, query: ScanHistoryQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await reposService.getScanHistory(
        req.auth!.orgId,
        req.params.id,
        Number(req.query.page ?? 1),
        Number(req.query.limit ?? 20),
      );
      res.json(successEnvelope(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }));
    } catch (err) { next(err); }
  },
);
