import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as repoService from './repositories.service.js';
import { ListReposSchema, RepoIdSchema, CreateRepoSchema } from './repositories.validation.js';

export const repositoriesRouter = Router();

repositoriesRouter.use(requireAuth);

// GET /repositories
repositoriesRouter.get(
  '/',
  requirePermission('view_findings'),
  validate({ query: ListReposSchema }),
  async (req, res, next) => {
    try {
      const result = await repoService.listRepositories(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);

// POST /repositories
repositoriesRouter.post(
  '/',
  requirePermission('manage_integrations'),
  validate({ body: CreateRepoSchema }),
  async (req, res, next) => {
    try {
      const repo = await repoService.createRepository(req.auth!.orgId, req.body);
      res.status(201).json(successEnvelope(repo));
    } catch (err) {
      next(err);
    }
  },
);

// GET /repositories/:id
repositoriesRouter.get(
  '/:id',
  requirePermission('view_findings'),
  validate({ params: RepoIdSchema }),
  async (req, res, next) => {
    try {
      const repo = await repoService.getRepositoryById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(repo));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /repositories/:id
repositoriesRouter.delete(
  '/:id',
  requirePermission('manage_integrations'),
  validate({ params: RepoIdSchema }),
  async (req, res, next) => {
    try {
      await repoService.deleteRepository(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// POST /repositories/:id/scan
repositoriesRouter.post(
  '/:id/scan',
  requirePermission('trigger_scans'),
  validate({ params: RepoIdSchema }),
  async (req, res, next) => {
    try {
      const scan = await repoService.triggerScan(req.auth!.orgId, req.params.id, req.requestId);
      res.status(201).json(successEnvelope(scan));
    } catch (err) {
      next(err);
    }
  },
);
