import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { signTokenPair } from '../../../src/lib/jwt.js';
import { errorHandler } from '../../../src/middleware/errors.js';
import { requestIdMiddleware } from '../../../src/middleware/request-id.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    server: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    scan: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  })),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock the CA sign function
vi.mock('../../../src/lib/ca.js', () => ({
  signCsr: vi.fn().mockReturnValue({
    certPem: '-----BEGIN CERTIFICATE-----\nmock\n-----END CERTIFICATE-----\n',
    caCertPem: '-----BEGIN CERTIFICATE-----\nmockca\n-----END CERTIFICATE-----\n',
  }),
  verifyClientCert: vi.fn().mockReturnValue(null), // default: reject
  getCa: vi.fn().mockReturnValue({ cert: 'ca', key: 'key' }),
}));

import { prisma } from '../../../src/lib/prisma.js';
import { verifyClientCert } from '../../../src/lib/ca.js';
import { agentsRouter } from '../../../src/modules/agents/agents.router.js';
import * as agentsService from '../../../src/modules/agents/agents.service.js';

const mockPrisma = vi.mocked(prisma);
const mockVerify = vi.mocked(verifyClientCert);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/v1/agents', agentsRouter);
  app.use(errorHandler);
  return app;
}

function apiKeyAuth() {
  return `Bearer ${signTokenPair({ sub: 'u1', org: 'org-1', role: 'member' }).accessToken}`;
}

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('Agents Router', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /v1/agents/register', () => {
    it('registers agent and returns signed cert', async () => {
      mockPrisma.server.create.mockResolvedValue({ id: UUID, agentId: null } as any);
      mockPrisma.server.update.mockResolvedValue({ id: UUID, agentId: UUID } as any);

      const res = await request(createApp())
        .post('/v1/agents/register')
        .set('Authorization', apiKeyAuth())
        .send({
          hostname: 'web-01',
          osFamily: 'ubuntu',
          osVersion: '22.04',
          csr: '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----\n',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.agentId).toBe(UUID);
      expect(res.body.data.signedCert).toContain('CERTIFICATE');
      expect(res.body.data.caCert).toContain('CERTIFICATE');
    });

    it('returns 401 without auth', async () => {
      const res = await request(createApp())
        .post('/v1/agents/register')
        .send({ hostname: 'web-01', osFamily: 'ubuntu', osVersion: '22.04', csr: 'test' });

      expect(res.status).toBe(401);
    });

    it('returns 422 for missing required fields', async () => {
      const res = await request(createApp())
        .post('/v1/agents/register')
        .set('Authorization', apiKeyAuth())
        .send({ hostname: 'web-01' }); // missing osFamily, osVersion, csr

      expect(res.status).toBe(422);
    });
  });

  describe('POST /v1/agents/heartbeat', () => {
    it('processes heartbeat with valid mTLS cert', async () => {
      mockVerify.mockReturnValue('ag_agent-123.agents.securitycentral.io');
      mockPrisma.server.findFirst.mockResolvedValue({
        id: UUID,
        agentId: 'agent-123',
        hostname: 'web-01',
        osFamily: 'ubuntu',
        osVersion: '22.04',
        metadata: {},
      } as any);
      mockPrisma.server.update.mockResolvedValue({} as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue(null);

      const res = await request(createApp())
        .post('/v1/agents/heartbeat')
        .set('X-Client-Cert', encodeURIComponent('-----BEGIN CERTIFICATE-----\nvalid\n-----END CERTIFICATE-----'))
        .send({ agentVersion: '1.0.0' });

      expect(res.status).toBe(200);
      expect(res.body.data.commands).toEqual([]);
    });

    it('returns update_agent command when version differs', async () => {
      mockVerify.mockReturnValue('ag_agent-123.agents.securitycentral.io');
      mockPrisma.server.findFirst.mockResolvedValue({
        id: UUID,
        agentId: 'agent-123',
        hostname: 'web-01',
        osFamily: 'ubuntu',
        osVersion: '22.04',
        metadata: {},
      } as any);
      mockPrisma.server.update.mockResolvedValue({} as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue(null);

      const res = await request(createApp())
        .post('/v1/agents/heartbeat')
        .set('X-Client-Cert', encodeURIComponent('-----BEGIN CERTIFICATE-----\nvalid\n-----END CERTIFICATE-----'))
        .send({ agentVersion: '0.9.0' });

      expect(res.status).toBe(200);
      expect(res.body.data.commands).toContainEqual(
        expect.objectContaining({ type: 'update_agent' }),
      );
    });

    it('returns scan_now command when pending scan exists', async () => {
      mockVerify.mockReturnValue('ag_agent-123.agents.securitycentral.io');
      mockPrisma.server.findFirst.mockResolvedValue({
        id: UUID,
        agentId: 'agent-123',
        hostname: 'web-01',
        osFamily: 'ubuntu',
        osVersion: '22.04',
        metadata: {},
      } as any);
      mockPrisma.server.update.mockResolvedValue({} as any);
      (mockPrisma.scan.findFirst as any).mockResolvedValue({
        id: 'scan-1',
        scanType: 'infra_packages',
        status: 'pending',
      });

      const res = await request(createApp())
        .post('/v1/agents/heartbeat')
        .set('X-Client-Cert', encodeURIComponent('-----BEGIN CERTIFICATE-----\nvalid\n-----END CERTIFICATE-----'))
        .send({ agentVersion: '1.0.0' });

      expect(res.body.data.commands).toContainEqual(
        expect.objectContaining({ type: 'scan_now', payload: expect.objectContaining({ scanId: 'scan-1' }) }),
      );
    });

    it('rejects heartbeat without mTLS cert', async () => {
      mockVerify.mockReturnValue(null);

      const res = await request(createApp())
        .post('/v1/agents/heartbeat')
        .send({ agentVersion: '1.0.0' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /v1/agents/version', () => {
    it('returns latest version and download URLs', async () => {
      const res = await request(createApp()).get('/v1/agents/version');

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe('1.0.0');
      expect(res.body.data.platforms['linux/amd64']).toBeDefined();
      expect(res.body.data.platforms['linux/arm64']).toBeDefined();
    });
  });
});

describe('Agents Service — Offline Detection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks stale servers as inactive and enqueues notification', async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    mockPrisma.server.findMany.mockResolvedValue([
      { id: 's1', orgId: 'org-1', hostname: 'web-old', lastHeartbeat: staleDate },
    ] as any);
    mockPrisma.server.update.mockResolvedValue({} as any);

    const count = await agentsService.detectOfflineAgents();

    expect(count).toBe(1);
    expect(mockPrisma.server.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'inactive' } }),
    );
  });

  it('returns 0 when no servers are offline', async () => {
    mockPrisma.server.findMany.mockResolvedValue([]);

    const count = await agentsService.detectOfflineAgents();
    expect(count).toBe(0);
  });
});
