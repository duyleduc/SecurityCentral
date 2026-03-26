import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as certsService from './certificates.service.js';
import { ListCertsSchema, CertIdSchema, ExpiringQuerySchema } from './certificates.validation.js';

export const certificatesRouter = Router();

certificatesRouter.use(requireAuth);

// GET /certificates/expiring — MUST be before /:id
certificatesRouter.get(
  '/expiring',
  requirePermission('view_findings'),
  validate({ query: ExpiringQuerySchema }),
  async (req, res, next) => {
    try {
      const result = await certsService.getExpiringCertificates(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);

// GET /certificates
certificatesRouter.get(
  '/',
  requirePermission('view_findings'),
  validate({ query: ListCertsSchema }),
  async (req, res, next) => {
    try {
      const result = await certsService.listCertificates(req.auth!.orgId, req.query as any);
      res.json({ data: result.data, meta: result.meta, errors: [] });
    } catch (err) {
      next(err);
    }
  },
);

// GET /certificates/:id
certificatesRouter.get(
  '/:id',
  requirePermission('view_findings'),
  validate({ params: CertIdSchema }),
  async (req, res, next) => {
    try {
      const cert = await certsService.getCertificateById(req.auth!.orgId, req.params.id);
      res.json(successEnvelope(cert));
    } catch (err) {
      next(err);
    }
  },
);
