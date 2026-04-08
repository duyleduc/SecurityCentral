import type { Request, Response, NextFunction } from 'express';

import { verifyAccessToken } from '../lib/jwt.js';
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
    // API key auth will be implemented with the agents module
    return next(new AppError('AUTH_INVALID_CREDENTIALS', 'API key authentication not yet implemented'));
  }

  next(new AppError('AUTH_INVALID_CREDENTIALS', 'Authentication required'));
}
