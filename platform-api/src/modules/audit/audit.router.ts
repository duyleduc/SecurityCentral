import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { successEnvelope } from '../../middleware/errors.js';
import * as auditService from './audit.service.js';

export const auditRouter = Router();

auditRouter.use(requireAuth);

// GET /api/v1/audit-logs
auditRouter.get('/', requirePermission('manage_org'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const entityType = req.query.entityType as string | undefined;
    const action = req.query.action as string | undefined;

    const result = await auditService.list({
      orgId: req.auth!.orgId,
      page,
      limit,
      entityType,
      action,
    });
    res.json(successEnvelope(result.items, { total: result.total, page: result.page, limit: result.limit }));
  } catch (err) {
    next(err);
  }
});
