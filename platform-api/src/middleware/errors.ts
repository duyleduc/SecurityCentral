import type { Request, Response, NextFunction } from 'express';

import { logger } from '../lib/logger.js';

export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_INSUFFICIENT_SCOPE: 403,
  AUTH_FORBIDDEN: 403,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RATE_LIMIT_EXCEEDED: 429,
  AGENT_ALREADY_REGISTERED: 409,
  INSTALL_TOKEN_INVALID: 401,
  INSTALL_TOKEN_EXPIRED: 410,
  INSTALL_TOKEN_ALREADY_USED: 410,
  CONFLICT: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_CODES[code];
    this.details = details;
  }
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly details?: unknown;
}

export interface ApiEnvelope<T = unknown> {
  readonly data: T | null;
  readonly meta: Record<string, unknown> | null;
  readonly errors: readonly ApiError[];
}

export function successEnvelope<T>(data: T, meta?: Record<string, unknown>): ApiEnvelope<T> {
  return { data, meta: meta ?? null, errors: [] };
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const envelope: ApiEnvelope<null> = {
      data: null,
      meta: null,
      errors: [
        {
          code: err.code,
          message: err.message,
          status: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      ],
    };
    res.status(err.statusCode).json(envelope);
    return;
  }

  logger.error('Unhandled error', { error: err.message, stack: err.stack });

  const envelope: ApiEnvelope<null> = {
    data: null,
    meta: null,
    errors: [{ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', status: 500 }],
  };
  res.status(500).json(envelope);
}
