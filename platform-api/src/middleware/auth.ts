import type { Request, Response, NextFunction } from 'express';

import { verifyAccessToken } from '../lib/jwt.js';
import { authenticateApiKey } from '../modules/auth/auth.service.js';
import { AppError } from './errors.js';

export interface AuthContext {
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
  readonly scopes?: readonly string[];
  readonly authMethod: 'jwt' | 'api_key';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Auth middleware — extracts identity from:
 *   1. Authorization: Bearer <JWT>
 *   2. X-API-Key: sc_live_...
 *
 * On success, attaches `req.auth` with userId, orgId, role, scopes.
 * On failure, returns 401 with appropriate error code.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // --- Try JWT Bearer ---
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payload = verifyAccessToken(token);

      req.auth = {
        userId: payload.sub,
        orgId: payload.org,
        role: payload.role,
        authMethod: 'jwt',
      };

      return next();
    } catch {
      return next(new AppError('AUTH_TOKEN_EXPIRED', 'Access token is invalid or expired'));
    }
  }

  // --- Try API Key ---
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    try {
      const keyRecord = await authenticateApiKey(apiKey);

      req.auth = {
        userId: keyRecord.createdBy,
        orgId: keyRecord.orgId,
        role: 'member', // API keys act as member role by default
        scopes: keyRecord.scopes,
        authMethod: 'api_key',
      };

      return next();
    } catch (err) {
      return next(err);
    }
  }

  next(new AppError('AUTH_INVALID_CREDENTIALS', 'Authentication required'));
}

/**
 * Scope-checking middleware for API key routes.
 * Call after requireAuth. If auth method is JWT, scope check is skipped (JWT has full role access).
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(new AppError('AUTH_INVALID_CREDENTIALS', 'Authentication required'));
    }

    // JWT users bypass scope check — they have full role-based access
    if (req.auth.authMethod === 'jwt') {
      return next();
    }

    // API key — check scopes
    const keyScopes = req.auth.scopes ?? [];
    const missing = requiredScopes.filter((s) => !keyScopes.includes(s));

    if (missing.length > 0) {
      return next(
        new AppError('AUTH_INSUFFICIENT_SCOPE', `API key missing required scope(s): ${missing.join(', ')}`),
      );
    }

    next();
  };
}
