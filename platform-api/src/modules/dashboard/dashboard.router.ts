import { Router } from 'express';

import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as dashboardService from './dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.use(requirePermission('view_dashboard'));

// GET /dashboard/summary
dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    const summary = await dashboardService.getSummary(req.auth!.orgId);
    res.json(successEnvelope(summary));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/top-risks
dashboardRouter.get('/top-risks', async (req, res, next) => {
  try {
    const risks = await dashboardService.getTopRisks(req.auth!.orgId);
    res.json(successEnvelope(risks));
  } catch (err) {
    next(err);
  }
});

// GET /dashboard/assets-overview
dashboardRouter.get('/assets-overview', async (req, res, next) => {
  try {
    const overview = await dashboardService.getAssetsOverview(req.auth!.orgId);
    res.json(successEnvelope(overview));
  } catch (err) {
    next(err);
  }
});
