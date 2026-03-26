import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { AppError, errorHandler, ERROR_CODES, type ErrorCode } from '../../src/middleware/errors.js';

function createApp(thrower: () => never) {
  const app = express();
  app.get('/test', (_req, _res) => thrower());
  app.use(errorHandler);
  return app;
}

describe('Error Handling Middleware', () => {
  it('returns envelope format for AppError', async () => {
    const app = createApp(() => {
      throw new AppError('RESOURCE_NOT_FOUND', 'Item not found');
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      data: null,
      meta: null,
      errors: [{ code: 'RESOURCE_NOT_FOUND', message: 'Item not found', status: 404 }],
    });
  });

  it('includes details when provided', async () => {
    const details = [{ path: 'email', message: 'Required' }];
    const app = createApp(() => {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', details);
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(422);
    expect(res.body.errors[0].details).toEqual(details);
  });

  it('returns 500 for unknown errors without leaking internals', async () => {
    const app = createApp(() => {
      throw new Error('database connection lost');
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
    expect(res.body.errors[0].message).not.toContain('database');
  });

  it.each(Object.entries(ERROR_CODES))('AppError(%s) produces HTTP %i', (code, expectedStatus) => {
    const err = new AppError(code as ErrorCode, 'test');
    expect(err.statusCode).toBe(expectedStatus);
  });
});
