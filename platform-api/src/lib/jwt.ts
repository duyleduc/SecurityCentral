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

export function signTokenPair(payload: JwtPayload): TokenPair {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ sub: payload.sub, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });
  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload & jwt.JwtPayload;
  return { sub: decoded.sub, org: decoded.org, role: decoded.role };
}

export function verifyRefreshToken(token: string): string {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
  return decoded.sub;
}
