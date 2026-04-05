import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as projectsService from './projects.service.js';
import * as scansService from '../scans/scans.service.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

const AssignAssetSchema = z.object({
  projectId: z.string().uuid(),
});

// GET /projects
projectsRouter.get('/', requirePermission('view_findings'), async (req, res, next) => {
  try {
    const projects = await projectsService.listProjects(req.auth!.orgId);
    res.json(successEnvelope(projects));
  } catch (err) { next(err); }
});

// POST /projects
projectsRouter.post('/', requirePermission('manage_integrations'), validate({ body: CreateProjectSchema }), async (req, res, next) => {
  try {
    const project = await projectsService.createProject(req.auth!.orgId, req.body.name, req.body.description);
    res.status(201).json(successEnvelope(project));
  } catch (err) { next(err); }
});

// GET /projects/:id/summary — MUST be before /:id
projectsRouter.get('/:id/summary', requirePermission('view_findings'), validate({ params: IdParam }), async (req, res, next) => {
  try {
    const summary = await projectsService.getProjectSummary(req.auth!.orgId, req.params.id);
    res.json(successEnvelope(summary));
  } catch (err) { next(err); }
});

// GET /projects/:id
projectsRouter.get('/:id', requirePermission('view_findings'), validate({ params: IdParam }), async (req, res, next) => {
  try {
    const project = await projectsService.getProject(req.auth!.orgId, req.params.id);
    res.json(successEnvelope(project));
  } catch (err) { next(err); }
});

// PATCH /projects/:id
projectsRouter.patch('/:id', requirePermission('manage_integrations'), validate({ params: IdParam, body: UpdateProjectSchema }), async (req, res, next) => {
  try {
    const project = await projectsService.updateProject(req.auth!.orgId, req.params.id, req.body);
    res.json(successEnvelope(project));
  } catch (err) { next(err); }
});

// DELETE /projects/:id
projectsRouter.delete('/:id', requirePermission('manage_integrations'), validate({ params: IdParam }), async (req, res, next) => {
  try {
    await projectsService.deleteProject(req.auth!.orgId, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /projects/:id/repos/:repoId — assign repo to project
projectsRouter.post('/:id/repos/:repoId', requirePermission('manage_integrations'), async (req, res, next) => {
  try {
    await projectsService.assignRepoToProject(req.auth!.orgId, req.params.repoId, req.params.id);
    res.json(successEnvelope({ assigned: true }));
  } catch (err) { next(err); }
});

// DELETE /projects/:id/repos/:repoId — remove repo from project
projectsRouter.delete('/:id/repos/:repoId', requirePermission('manage_integrations'), async (req, res, next) => {
  try {
    await projectsService.removeRepoFromProject(req.auth!.orgId, req.params.repoId, req.params.id);
    res.json(successEnvelope({ removed: true }));
  } catch (err) { next(err); }
});

// POST /projects/:id/servers/:serverId — assign server to project
projectsRouter.post('/:id/servers/:serverId', requirePermission('manage_integrations'), async (req, res, next) => {
  try {
    await projectsService.assignServerToProject(req.auth!.orgId, req.params.serverId, req.params.id);
    res.json(successEnvelope({ assigned: true }));
  } catch (err) { next(err); }
});

// DELETE /projects/:id/servers/:serverId — remove server from project
projectsRouter.delete('/:id/servers/:serverId', requirePermission('manage_integrations'), async (req, res, next) => {
  try {
    await projectsService.removeServerFromProject(req.auth!.orgId, req.params.serverId);
    res.json(successEnvelope({ removed: true }));
  } catch (err) { next(err); }
});

// POST /repositories/:repoId/assign — assign repo to project (alternative: from repo side)
projectsRouter.post('/assign-repo/:repoId', requirePermission('manage_integrations'), validate({ body: AssignAssetSchema }), async (req, res, next) => {
  try {
    await projectsService.assignRepoToProject(req.auth!.orgId, req.params.repoId, req.body.projectId);
    res.json(successEnvelope({ assigned: true }));
  } catch (err) { next(err); }
});

// DELETE /projects/:id/scan-history — clear completed/failed/cancelled scan history
projectsRouter.delete('/:id/scan-history', requirePermission('trigger_scans'), validate({ params: IdParam }), async (req, res, next) => {
  try {
    const result = await scansService.clearProjectScanHistory(req.auth!.orgId, req.params.id);
    res.json(successEnvelope(result));
  } catch (err) { next(err); }
});
