import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { verifyAccessToken } from '../lib/jwt.js';
import { getRedisConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'websocket' });

let io: SocketIOServer | null = null;

// ---------------------------------------------------------------------------
// T-11.1.3: Event types per spec §4.8
// ---------------------------------------------------------------------------

export type WsEventType =
  | 'finding:new'
  | 'finding:resolved'
  | 'scan:started'
  | 'scan:completed'
  | 'agent:connected'
  | 'agent:disconnected'
  | 'cert:expiring';

// ---------------------------------------------------------------------------
// T-11.1.1 + T-11.1.2: Server setup with JWT auth + Redis adapter
// ---------------------------------------------------------------------------

/**
 * Set up the Socket.IO server with JWT authentication and Redis pub/sub adapter.
 * Connections are authenticated via JWT in the handshake `auth.token` field.
 * Each connection joins an org-scoped room `org:<orgId>`.
 */
export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    path: '/ws',
    cors: {
      origin: '*', // tightened per CORS_ORIGINS in production
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Redis adapter for multi-instance fan-out
  try {
    const pubClient = getRedisConnection().duplicate();
    const subClient = getRedisConnection().duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    log.info('Socket.IO Redis adapter configured');
  } catch (err) {
    log.warn('Redis adapter setup failed, running single-instance', { error: (err as Error).message });
  }

  // JWT authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyAccessToken(token);
      (socket.data as Record<string, string>).userId = payload.sub;
      (socket.data as Record<string, string>).orgId = payload.org;
      (socket.data as Record<string, string>).role = payload.role;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // Connection handler — join org room
  io.on('connection', (socket) => {
    const orgId = (socket.data as Record<string, string>).orgId;
    const userId = (socket.data as Record<string, string>).userId;

    const orgRoom = `org:${orgId}`;
    socket.join(orgRoom);

    log.info('Client connected', { socketId: socket.id, userId, orgRoom });

    socket.on('disconnect', (reason) => {
      log.info('Client disconnected', { socketId: socket.id, userId, reason });
    });
  });

  log.info('WebSocket server initialized');
  return io;
}

// ---------------------------------------------------------------------------
// T-11.1.3: Event emission to org-scoped rooms
// ---------------------------------------------------------------------------

/**
 * Emit an event to all connected clients in an org.
 * Safe to call even if WebSocket is not initialized (no-op).
 */
export function emitToOrg(orgId: string, event: WsEventType, payload: Record<string, unknown>): void {
  if (!io) return;

  const room = `org:${orgId}`;
  io.to(room).emit(event, payload);
  log.debug('WebSocket event emitted', { event, orgId, room });
}

// ---------------------------------------------------------------------------
// T-11.1.3: Typed event emitters for each spec event
// ---------------------------------------------------------------------------

export function emitFindingNew(orgId: string, data: { finding_id: string; severity: string; title: string; source: string }): void {
  emitToOrg(orgId, 'finding:new', data);
}

export function emitFindingResolved(orgId: string, data: { finding_id: string }): void {
  emitToOrg(orgId, 'finding:resolved', data);
}

export function emitScanStarted(orgId: string, data: { scan_id: string; scan_type: string; asset: string }): void {
  emitToOrg(orgId, 'scan:started', data);
}

export function emitScanCompleted(orgId: string, data: { scan_id: string; findings_total: number; findings_new: number }): void {
  emitToOrg(orgId, 'scan:completed', data);
}

export function emitAgentConnected(orgId: string, data: { server_id: string; hostname: string }): void {
  emitToOrg(orgId, 'agent:connected', data);
}

export function emitAgentDisconnected(orgId: string, data: { server_id: string; hostname: string }): void {
  emitToOrg(orgId, 'agent:disconnected', data);
}

export function emitCertExpiring(orgId: string, data: { certificate_id: string; subject_cn: string; days_until_expiry: number }): void {
  emitToOrg(orgId, 'cert:expiring', data);
}
