import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { successEnvelope } from '../../middleware/errors.js';
import * as apiKeysService from './apikeys.service.js';

export const apiKeysRouter = Router();

apiKeysRouter.use(requireAuth);

// GET /api/v1/api-keys
apiKeysRouter.get('/', requirePermission('create_api_keys'), async (req, res, next) => {
  try {
    const keys = await apiKeysService.list(req.auth!.orgId);
    res.json(successEnvelope(keys));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/api-keys
apiKeysRouter.post('/', requirePermission('create_api_keys'), async (req, res, next) => {
  try {
    const result = await apiKeysService.create({
      orgId: req.auth!.orgId,
      createdBy: req.auth!.userId,
      name: req.body.name,
      scopes: req.body.scopes,
      expiresInDays: req.body.expiresInDays,
    });
    res.status(201).json(successEnvelope(result));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/api-keys/:id
apiKeysRouter.delete('/:id', requirePermission('create_api_keys'), async (req, res, next) => {
  try {
    await apiKeysService.revoke(req.auth!.orgId, req.params.id);
    res.json(successEnvelope({ deleted: true }));
  } catch (err) {
    next(err);
  }
});
