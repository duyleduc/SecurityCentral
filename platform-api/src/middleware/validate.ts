import type { Request, Response, NextFunction } from 'express';
import { type ZodSchema, ZodError } from 'zod';

import { AppError } from './errors.js';

interface ValidationSchemas {
  readonly body?: ZodSchema;
  readonly query?: ZodSchema;
  readonly params?: ZodSchema;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as Record<string, string>;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Record<string, string>;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        next(new AppError('VALIDATION_ERROR', 'Request validation failed', details));
        return;
      }
      next(err);
    }
  };
}
