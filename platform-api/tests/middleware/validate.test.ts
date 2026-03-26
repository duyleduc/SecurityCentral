import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { validate } from '../../src/middleware/validate.js';
import { errorHandler } from '../../src/middleware/errors.js';

function createApp(schemas: Parameters<typeof validate>[0]) {
  const app = express();
  app.use(express.json());
  app.post('/test/:id?', validate(schemas), (req, res) => {
    res.json({ body: req.body, query: req.query, params: req.params });
  });
  app.use(errorHandler);
  return app;
}

describe('Zod Validation Middleware', () => {
  const bodySchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
  });

  it('passes valid body through', async () => {
    const app = createApp({ body: bodySchema });
    const res = await request(app).post('/test').send({ name: 'Alice', email: 'alice@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });

  it('returns VALIDATION_ERROR for invalid body', async () => {
    const app = createApp({ body: bodySchema });
    const res = await request(app).post('/test').send({ name: '', email: 'bad' });

    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].details).toBeInstanceOf(Array);
    expect(res.body.errors[0].details.length).toBeGreaterThan(0);
  });

  it('validates query params', async () => {
    const querySchema = z.object({ page: z.string().regex(/^\d+$/) });
    const app = createApp({ query: querySchema });

    const res = await request(app).post('/test?page=abc').send({});
    expect(res.status).toBe(422);
  });

  it('validates route params', async () => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const app = createApp({ params: paramsSchema });

    const res = await request(app).post('/test/not-a-uuid').send({});
    expect(res.status).toBe(422);
  });

  it('returns field-level error details', async () => {
    const app = createApp({ body: bodySchema });
    const res = await request(app).post('/test').send({ name: '', email: 'bad' });

    const details = res.body.errors[0].details as Array<{ path: string; message: string }>;
    const paths = details.map((d) => d.path);
    expect(paths).toContain('name');
    expect(paths).toContain('email');
  });
});
