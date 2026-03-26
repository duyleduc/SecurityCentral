import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { listAuditLogs } from '../../lib/audit.js';
import { ListAuditLogsSchema } from './audit.validation.js';

export const auditRouter = Router();

auditRouter.use(requireAuth);

// GET /audit-logs
auditRouter.get(
  '/',
  requirePermission('manage_org'),
  validate({ query: ListAuditLogsSchema }),
  async (req, res, next) => {
    try {
      const result = await listAuditLogs(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);
