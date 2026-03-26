import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Generates a UUID request_id for every incoming request.
 * - Attaches it to `req.requestId`
 * - Sets `X-Request-Id` response header
 * - Honors an incoming `X-Request-Id` header (e.g. from a load balancer)
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) ?? uuidv4();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  next();
}
