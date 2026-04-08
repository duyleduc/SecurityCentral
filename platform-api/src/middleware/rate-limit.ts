import type { Request, Response, NextFunction } from 'express';

import { AppError } from './errors.js';

interface RateLimitOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly prefix: string;
}

const API_LIMITS: RateLimitOptions = { maxRequests: 100, windowMs: 1000, prefix: 'api' };
const AGENT_LIMITS: RateLimitOptions = { maxRequests: 1000, windowMs: 1000, prefix: 'agent' };

// In-memory sliding window (no Redis for MVP)
const windows = new Map<string, { count: number; resetAt: number }>();

function getKey(req: Request, prefix: string): string {
  const orgId = req.auth?.orgId;
  return `${prefix}:${orgId ?? req.ip ?? 'unknown'}`;
}

function createRateLimiter(opts: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = getKey(req, opts.prefix);
    const now = Date.now();

    let window = windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + opts.windowMs };
      windows.set(key, window);
    }

    window.count++;
    const remaining = Math.max(0, opts.maxRequests - window.count);

    res.setHeader('X-RateLimit-Limit', String(opts.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (window.count > opts.maxRequests) {
      next(new AppError('RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later'));
      return;
    }

    next();
  };
}

// Cleanup stale windows every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (now >= window.resetAt) {
      windows.delete(key);
    }
  }
}, 60_000).unref();

export const apiRateLimit = createRateLimiter(API_LIMITS);
export const agentRateLimit = createRateLimiter(AGENT_LIMITS);
