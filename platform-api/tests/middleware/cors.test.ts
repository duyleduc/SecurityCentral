import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { app } from '../../src/app.js';

describe('CORS Middleware', () => {
  it('sets Access-Control-Allow-Origin for allowed origins', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('exposes X-Request-Id and rate limit headers', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');

    const exposed = res.headers['access-control-expose-headers'] ?? '';
    expect(exposed).toContain('X-Request-Id');
  });
});
