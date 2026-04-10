import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

let io: Server | null = null;

export function getIO(): Server | null {
  return io;
}

export function setupSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS.split(','),
      credentials: true,
    },
    path: '/ws',
  });

  // JWT authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      logger.warn('[ws] connection rejected — no token');
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string; orgId: string };
      socket.data.userId = decoded.sub;
      socket.data.orgId = decoded.orgId;
      next();
    } catch (err) {
      logger.warn('[ws] connection rejected — invalid token', { error: (err as Error).message });
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const orgId = socket.data.orgId;
    logger.info('[ws] client connected', { userId: socket.data.userId, orgId, socketId: socket.id });

    // Join org-scoped room
    socket.join(`org:${orgId}`);

    socket.on('disconnect', (reason) => {
      logger.info('[ws] client disconnected', { userId: socket.data.userId, socketId: socket.id, reason });
    });
  });

  logger.info('Socket.IO server initialized');
  return io;
}

// ---------------------------------------------------------------------------
// Broadcast helpers — emit to org-scoped rooms
// ---------------------------------------------------------------------------

export function broadcastToOrg(orgId: string, event: string, data: unknown): void {
  if (!io) {
    logger.warn('[ws] broadcast skipped — Socket.IO not initialized', { event, orgId });
    return;
  }
  const room = `org:${orgId}`;
  const clientCount = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  logger.debug('[ws] broadcasting', { event, orgId, clients: clientCount });
  io.to(room).emit(event, data);
}
