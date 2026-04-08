import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { CreateInstallTokenSchema } from './install-tokens.validation.js';
import { createInstallToken } from './install-tokens.service.js';

export const installTokensRouter = Router();

// ---------------------------------------------------------------------------
// POST /install-tokens — create a one-time agent install token (JWT auth)
// ---------------------------------------------------------------------------
installTokensRouter.post(
  '/',
  requireAuth,
  validate({ body: CreateInstallTokenSchema }),
  async (req, res, next) => {
    try {
      const result = await createInstallToken(req.auth!.orgId, req.auth!.userId, req.body);
      res.status(201).json(successEnvelope(result));
    } catch (err) {
      next(err);
    }
  },
);
