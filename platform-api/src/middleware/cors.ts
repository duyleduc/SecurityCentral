import cors from 'cors';

import { env } from '../lib/env.js';

/**
 * CORS middleware — allowed origins read from CORS_ORIGINS env var (comma-separated).
 */
export const corsMiddleware = cors({
  origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
});
