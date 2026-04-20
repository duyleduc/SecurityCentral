import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { successEnvelope } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import * as service from './invitations.service.js';
import {
  CreateInvitationSchema,
  InvitationIdParamsSchema,
  InvitationTokenParamsSchema,
  AcceptInvitationSchema,
} from './invitations.validation.js';

// ---------------------------------------------------------------------------
// Admin-facing: create/list/revoke invitations (mounted under /organization)
// ---------------------------------------------------------------------------
export const organizationInvitationsRouter = Router();

organizationInvitationsRouter.use(requireAuth);

organizationInvitationsRouter.post(
  '/',
  requirePermission('manage_users'),
  validate({ body: CreateInvitationSchema }),
  async (req, res, next) => {
    try {
      const invite = await service.createInvitation({
        orgId: req.auth!.orgId,
        createdBy: req.auth!.userId,
        name: req.body.name,
        email: req.body.email,
        role: req.body.role,
        expiresInHours: req.body.expiresInHours,
      });
      res.status(201).json(successEnvelope(invite));
    } catch (err) {
      next(err);
    }
  },
);

organizationInvitationsRouter.get(
  '/',
  requirePermission('manage_users'),
  async (req, res, next) => {
    try {
      const invites = await service.listPending(req.auth!.orgId);
      res.json(successEnvelope(invites));
    } catch (err) {
      next(err);
    }
  },
);

organizationInvitationsRouter.delete(
  '/:id',
  requirePermission('manage_users'),
  validate({ params: InvitationIdParamsSchema }),
  async (req, res, next) => {
    try {
      await service.revokeInvitation(req.auth!.orgId, req.params.id);
      res.json(successEnvelope({ deleted: true }));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Public-facing: invitee fetches details and accepts (no auth)
// ---------------------------------------------------------------------------
export const publicInvitationsRouter = Router();

publicInvitationsRouter.get(
  '/:token',
  validate({ params: InvitationTokenParamsSchema }),
  async (req, res, next) => {
    try {
      const invite = await service.getByToken(req.params.token);
      res.json(successEnvelope(invite));
    } catch (err) {
      next(err);
    }
  },
);

publicInvitationsRouter.post(
  '/:token/accept',
  validate({ params: InvitationTokenParamsSchema, body: AcceptInvitationSchema }),
  async (req, res, next) => {
    try {
      const result = await service.acceptInvitation(req.params.token, req.body.password);

      res.cookie('refresh_token', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/auth/refresh',
      });

      res.status(201).json(
        successEnvelope({
          accessToken: result.tokens.accessToken,
          user: result.user,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
