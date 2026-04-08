import type { Request, Response, NextFunction } from 'express';

import { requestLogger } from '../lib/logger.js';

/**
 * Logs every HTTP request with method, path, status, duration, and request_id.
 * Must be registered AFTER requestIdMiddleware.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();

  res.on('finish', () => {
    const duration_ms = Math.round(performance.now() - start);
    const log = requestLogger(req.requestId);

    log.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms,
      content_length: res.getHeader('content-length'),
    });
  });

  next();
}
