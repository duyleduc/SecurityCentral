import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { requestIdMiddleware } from '../../src/middleware/request-id.js';

function createApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/test', (req, res) => {
    res.json({ requestId: req.requestId });
  });
  return app;
}

describe('Request ID Middleware', () => {
  it('generates a UUID request_id and sets X-Request-Id header', async () => {
    const app = createApp();
    const res = await request(app).get('/test');

    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    // UUID v4 format
    expect(res.body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('honors an incoming X-Request-Id header', async () => {
    const app = createApp();
    const customId = 'my-custom-request-id-123';
    const res = await request(app).get('/test').set('X-Request-Id', customId);

    expect(res.headers['x-request-id']).toBe(customId);
    expect(res.body.requestId).toBe(customId);
  });
});
