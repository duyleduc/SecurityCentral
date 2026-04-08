import { describe, it, expect } from 'vitest';

import { signTokenPair, verifyAccessToken, verifyRefreshToken } from '../../src/lib/jwt.js';

describe('JWT Utility', () => {
  const payload = { sub: 'user-1', org: 'org-1', role: 'admin' };

  it('signs and verifies an access token', () => {
    const { accessToken } = signTokenPair(payload);
    const decoded = verifyAccessToken(accessToken);

    expect(decoded.sub).toBe('user-1');
    expect(decoded.org).toBe('org-1');
    expect(decoded.role).toBe('admin');
  });

  it('signs and verifies a refresh token', () => {
    const { refreshToken } = signTokenPair(payload);
    const userId = verifyRefreshToken(refreshToken);

    expect(userId).toBe('user-1');
  });

  it('returns both tokens', () => {
    const pair = signTokenPair(payload);
    expect(pair.accessToken).toBeDefined();
    expect(pair.refreshToken).toBeDefined();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });

  it('throws on invalid access token', () => {
    expect(() => verifyAccessToken('garbage')).toThrow();
  });

  it('throws on invalid refresh token', () => {
    expect(() => verifyRefreshToken('garbage')).toThrow();
  });

  it('access and refresh tokens use different secrets (cross-verify fails)', () => {
    const { accessToken, refreshToken } = signTokenPair(payload);

    // Refresh token should NOT verify as access token
    expect(() => verifyAccessToken(refreshToken)).toThrow();
    // Access token should NOT verify as refresh token
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });
});
