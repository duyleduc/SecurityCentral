import { Router } from 'express';

import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as dashboardService from './dashboard.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

function readProjectId(req: { query: Record<string, unknown> }): string | null {
  const raw = req.query.projectId;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

// GET /api/v1/dashboard/summary
dashboardRouter.get('/summary', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const summary = await dashboardService.getSummary(req.auth!.orgId, readProjectId(req));
    res.json(successEnvelope(summary));
  } catch (err) { next(err); }
});

// GET /api/v1/dashboard/top-risks
dashboardRouter.get('/top-risks', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const risks = await dashboardService.getTopRisks(req.auth!.orgId, readProjectId(req));
    res.json(successEnvelope(risks));
  } catch (err) { next(err); }
});

// GET /api/v1/dashboard/assets
dashboardRouter.get('/assets', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const assets = await dashboardService.getAssets(req.auth!.orgId, readProjectId(req));
    res.json(successEnvelope(assets));
  } catch (err) { next(err); }
});
