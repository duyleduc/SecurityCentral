import type { Request, Response, NextFunction } from 'express';

import { getRedisConnection } from '../lib/redis.js';
import { AppError } from './errors.js';

interface RateLimitOptions {
  /** Maximum requests allowed in the window. */
  readonly maxRequests: number;
  /** Window size in seconds. */
  readonly windowSeconds: number;
  /** Key prefix for Redis. */
  readonly prefix: string;
}

const API_LIMITS: RateLimitOptions = { maxRequests: 100, windowSeconds: 1, prefix: 'rl:api' };
const AGENT_LIMITS: RateLimitOptions = { maxRequests: 1000, windowSeconds: 1, prefix: 'rl:agent' };

/**
 * Extract the org identifier used as the rate-limit bucket.
 * Falls back to IP when no org context is available (pre-auth routes).
 */
function getOrgKey(req: Request): string {
  // After auth middleware sets req.orgId (added in Story 2)
  const orgId = (req as Record<string, unknown>).orgId as string | undefined;
  return orgId ?? req.ip ?? 'unknown';
}

/**
 * Redis sliding-window rate limiter using INCR + EXPIRE.
 */
async function checkLimit(key: string, opts: RateLimitOptions): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedisConnection();
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, opts.windowSeconds);
  }

  const remaining = Math.max(0, opts.maxRequests - current);
  return { allowed: current <= opts.maxRequests, remaining };
}

function createRateLimiter(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgKey = getOrgKey(req);
    const windowKey = `${opts.prefix}:${orgKey}:${Math.floor(Date.now() / (opts.windowSeconds * 1000))}`;

    try {
      const { allowed, remaining } = await checkLimit(windowKey, opts);

      res.setHeader('X-RateLimit-Limit', String(opts.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(remaining));

      if (!allowed) {
        next(new AppError('RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later'));
        return;
      }

      next();
    } catch (err) {
      // If Redis is down, allow the request through (fail-open)
      console.warn('[rate-limit] Redis error, allowing request:', (err as Error).message);
      next();
    }
  };
}

/** Rate limiter for standard API routes (100 req/s per org). */
export const apiRateLimit = createRateLimiter(API_LIMITS);

/** Rate limiter for agent routes (1000 req/s per org). */
export const agentRateLimit = createRateLimiter(AGENT_LIMITS);
