import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { successEnvelope, AppError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import * as orgService from './organizations.service.js';
import {
  UpdateMemberRoleSchema,
  MemberIdParamsSchema,
} from './organizations.validation.js';

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

// GET /api/v1/organization
organizationsRouter.get('/', requirePermission('view_dashboard'), async (req, res, next) => {
  try {
    const org = await orgService.getById(req.auth!.orgId);
    res.json(successEnvelope(org));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/organization
organizationsRouter.patch('/', requirePermission('manage_org'), async (req, res, next) => {
  try {
    const org = await orgService.update(req.auth!.orgId, req.body);
    res.json(successEnvelope(org));
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/organization/members
organizationsRouter.get('/members', requirePermission('manage_org'), async (req, res, next) => {
  try {
    const members = await orgService.listMembers(req.auth!.orgId);
    res.json(successEnvelope(members));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/organization/members/:id
organizationsRouter.patch(
  '/members/:id',
  requirePermission('manage_users'),
  validate({ params: MemberIdParamsSchema, body: UpdateMemberRoleSchema }),
  async (req, res, next) => {
    try {
      if (req.params.id === req.auth!.userId) {
        return next(new AppError('VALIDATION_ERROR', 'You cannot change your own role'));
      }
      const member = await orgService.updateMemberRole(req.auth!.orgId, req.params.id, req.body.role);
      res.json(successEnvelope(member));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/organization/members/:id
organizationsRouter.delete(
  '/members/:id',
  requirePermission('manage_users'),
  validate({ params: MemberIdParamsSchema }),
  async (req, res, next) => {
    try {
      if (req.params.id === req.auth!.userId) {
        return next(new AppError('VALIDATION_ERROR', 'You cannot remove yourself'));
      }
      await orgService.removeMember(req.auth!.orgId, req.params.id);
      res.json(successEnvelope({ deleted: true }));
    } catch (err) {
      next(err);
    }
  },
);
