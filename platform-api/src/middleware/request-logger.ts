import type { Request, Response, NextFunction } from 'express';

import { requestLogger } from '../lib/logger.js';

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
    });
  });

  next();
}
