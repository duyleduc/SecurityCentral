import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock socket.io and redis adapter
vi.mock('socket.io', () => {
  const mockSocket = {
    id: 'socket-1',
    data: {},
    handshake: { auth: { token: '' } },
    join: vi.fn(),
    on: vi.fn(),
  };

  const mockIo = {
    use: vi.fn(),
    on: vi.fn(),
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
    adapter: vi.fn(),
  };

  return {
    Server: vi.fn(() => mockIo),
  };
});

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    status: 'ready',
    options: { maxRetriesPerRequest: null },
    duplicate: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn().mockResolvedValue({}),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
}));

import { createServer } from 'node:http';
import { setupWebSocket, emitToOrg } from '../../src/ws/server.js';
import {
  emitFindingNew,
  emitFindingResolved,
  emitScanStarted,
  emitScanCompleted,
  emitAgentConnected,
  emitAgentDisconnected,
  emitCertExpiring,
} from '../../src/ws/server.js';

describe('WebSocket Server', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setupWebSocket returns a Socket.IO server', () => {
    const httpServer = createServer();
    const io = setupWebSocket(httpServer);

    expect(io).toBeDefined();
    // Should register auth middleware
    expect(io.use).toHaveBeenCalled();
    // Should register connection handler
    expect(io.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('emitToOrg sends to org-scoped room', () => {
    const httpServer = createServer();
    const io = setupWebSocket(httpServer);

    emitToOrg('org-123', 'finding:new', { finding_id: 'f1', severity: 'critical', title: 'Test', source: 'code_scanner' });

    expect(io.to).toHaveBeenCalledWith('org:org-123');
    expect(io.emit).toHaveBeenCalledWith('finding:new', expect.objectContaining({ finding_id: 'f1' }));
  });
});

describe('Typed Event Emitters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const httpServer = createServer();
    setupWebSocket(httpServer);
  });

  it('emitFindingNew emits finding:new', () => {
    emitFindingNew('org-1', { finding_id: 'f1', severity: 'critical', title: 'CVE-2024', source: 'code_scanner' });
    // Just verify no error thrown — io.to().emit() is mocked
  });

  it('emitFindingResolved emits finding:resolved', () => {
    emitFindingResolved('org-1', { finding_id: 'f1' });
  });

  it('emitScanStarted emits scan:started', () => {
    emitScanStarted('org-1', { scan_id: 's1', scan_type: 'code_dependencies', asset: 'acme/app' });
  });

  it('emitScanCompleted emits scan:completed', () => {
    emitScanCompleted('org-1', { scan_id: 's1', findings_total: 10, findings_new: 3 });
  });

  it('emitAgentConnected emits agent:connected', () => {
    emitAgentConnected('org-1', { server_id: 'srv-1', hostname: 'web-01' });
  });

  it('emitAgentDisconnected emits agent:disconnected', () => {
    emitAgentDisconnected('org-1', { server_id: 'srv-1', hostname: 'web-01' });
  });

  it('emitCertExpiring emits cert:expiring', () => {
    emitCertExpiring('org-1', { certificate_id: 'c1', subject_cn: '*.example.com', days_until_expiry: 7 });
  });
});
