import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { RegisterSchema, LoginSchema, CreateApiKeySchema } from './auth.validation.js';
import * as authService from './auth.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
authRouter.post('/register', validate({ body: RegisterSchema }), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);

    // Set refresh token as HttpOnly cookie
    res.cookie('refresh_token', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/auth/refresh',
    });

    res.status(201).json(
      successEnvelope({
        accessToken: result.tokens.accessToken,
        user: result.user,
        org: result.org,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
authRouter.post('/login', validate({ body: LoginSchema }), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);

    res.cookie('refresh_token', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/auth/refresh',
    });

    res.json(
      successEnvelope({
        accessToken: result.tokens.accessToken,
        user: result.user,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    if (!refreshToken) {
      return res.status(401).json({
        data: null,
        meta: null,
        errors: [{ code: 'AUTH_TOKEN_EXPIRED', message: 'No refresh token provided', status: 401 }],
      });
    }

    const tokens = await authService.refresh(refreshToken);

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/auth/refresh',
    });

    res.json(successEnvelope({ accessToken: tokens.accessToken }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/api-keys (authenticated)
// ---------------------------------------------------------------------------
authRouter.post(
  '/api-keys',
  requireAuth,
  requireRole('member'),
  validate({ body: CreateApiKeySchema }),
  async (req, res, next) => {
    try {
      const result = await authService.createApiKey({
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
  },
);

// ---------------------------------------------------------------------------
// GET /auth/api-keys (authenticated)
// ---------------------------------------------------------------------------
authRouter.get('/api-keys', requireAuth, requireRole('viewer'), async (req, res, next) => {
  try {
    const keys = await authService.listApiKeys(req.auth!.orgId);
    res.json(successEnvelope(keys));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /auth/api-keys/:id (authenticated)
// ---------------------------------------------------------------------------
authRouter.delete('/api-keys/:id', requireAuth, requireRole('member'), async (req, res, next) => {
  try {
    await authService.revokeApiKey(req.auth!.orgId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
