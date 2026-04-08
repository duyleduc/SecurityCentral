import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { CreateProjectSchema, UpdateProjectSchema, ProjectIdParamsSchema } from './projects.validation.js';
import * as projectsService from './projects.service.js';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

// GET /api/v1/projects
projectsRouter.get('/', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const projects = await projectsService.list(req.auth!.orgId);
    res.json(successEnvelope(projects));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/projects
projectsRouter.post(
  '/',
  requirePermission('manage_projects'),
  validate({ body: CreateProjectSchema }),
  async (req, res, next) => {
    try {
      const project = await projectsService.create({
        orgId: req.auth!.orgId,
        ...req.body,
      });
      res.status(201).json(successEnvelope(project));
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/projects/:id
projectsRouter.get(
  '/:id',
  requirePermission('view_dashboard'),
  validate({ params: ProjectIdParamsSchema }),
  async (req, res, next) => {
    try {
      const project = await projectsService.getById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(project));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/projects/:id
projectsRouter.patch(
  '/:id',
  requirePermission('manage_projects'),
  validate({ params: ProjectIdParamsSchema, body: UpdateProjectSchema }),
  async (req, res, next) => {
    try {
      const project = await projectsService.update(req.auth!.orgId, req.params.id, req.body);
      res.json(successEnvelope(project));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/projects/:id
projectsRouter.delete(
  '/:id',
  requirePermission('manage_projects'),
  validate({ params: ProjectIdParamsSchema }),
  async (req, res, next) => {
    try {
      await projectsService.remove(req.auth!.orgId, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/projects/:id/summary
projectsRouter.get(
  '/:id/summary',
  requirePermission('view_dashboard'),
  validate({ params: ProjectIdParamsSchema }),
  async (req, res, next) => {
    try {
      const summary = await projectsService.getSummary(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(summary));
    } catch (err) {
      next(err);
    }
  },
);
