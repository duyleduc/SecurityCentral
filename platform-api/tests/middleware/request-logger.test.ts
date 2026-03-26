import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { requestLoggerMiddleware } from '../../src/middleware/request-logger.js';

describe('Request Logger Middleware', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(requestLoggerMiddleware);
    app.get('/test', (_req, res) => res.json({ ok: true }));
    app.get('/slow', (_req, res) => {
      setTimeout(() => res.json({ ok: true }), 10);
    });
    return app;
  }

  it('logs method, path, status, duration_ms, and request_id', async () => {
    const app = createApp();
    await request(app).get('/test');

    expect(stdoutSpy).toHaveBeenCalled();
    const line = stdoutSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0] as string);
        return parsed.message === 'HTTP request';
      } catch {
        return false;
      }
    });

    expect(line).toBeDefined();
    const entry = JSON.parse(line![0] as string);
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/test');
    expect(entry.status).toBe(200);
    expect(typeof entry.duration_ms).toBe('number');
    expect(entry.request_id).toBeDefined();
  });

  it('includes the correct request_id from the header', async () => {
    const app = createApp();
    const customId = 'trace-abc-789';
    await request(app).get('/test').set('X-Request-Id', customId);

    const line = stdoutSpy.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0] as string);
        return parsed.message === 'HTTP request';
      } catch {
        return false;
      }
    });

    const entry = JSON.parse(line![0] as string);
    expect(entry.request_id).toBe(customId);
  });
});
