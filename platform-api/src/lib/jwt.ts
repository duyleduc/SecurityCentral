import jwt from 'jsonwebtoken';

import { env } from './env.js';

export interface JwtPayload {
  sub: string;   // user_id
  org: string;   // org_id
  role: string;  // owner | admin | member | viewer
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

const ACCESS_TTL = '1h';
const REFRESH_TTL = '30d';

/**
 * Sign an access + refresh token pair.
 */
export function signTokenPair(payload: JwtPayload): TokenPair {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ sub: payload.sub, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });
  return { accessToken, refreshToken };
}

/**
 * Verify and decode an access token.
 * Throws on invalid/expired tokens.
 */
export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload & jwt.JwtPayload;
  return { sub: decoded.sub, org: decoded.org, role: decoded.role };
}

/**
 * Verify a refresh token and return the user ID (sub).
 * Throws on invalid/expired tokens.
 */
export function verifyRefreshToken(token: string): string {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
  return decoded.sub;
}
