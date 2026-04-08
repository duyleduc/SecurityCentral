import { Router } from 'express';

import { validate } from '../../middleware/validate.js';
import { successEnvelope } from '../../middleware/errors.js';
import { RegisterSchema, LoginSchema } from './auth.validation.js';
import * as authService from './auth.service.js';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
authRouter.post('/register', validate({ body: RegisterSchema }), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);

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
