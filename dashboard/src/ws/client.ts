// ---------------------------------------------------------------------------
// Socket.IO WebSocket client with JWT auth + auto-reconnect
// ---------------------------------------------------------------------------

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '../api/client.js';

export type WsEventType =
  | 'finding:new'
  | 'finding:resolved'
  | 'scan:started'
  | 'scan:completed'
  | 'agent:connected'
  | 'agent:disconnected'
  | 'cert:expiring';

type EventHandler = (payload: Record<string, unknown>) => void;

const WS_URL = import.meta.env.VITE_WS_URL ?? '';

let socket: Socket | null = null;
const handlers = new Map<WsEventType, Set<EventHandler>>();

/**
 * Connect to the WebSocket server with JWT authentication.
 * Auto-reconnects with exponential backoff.
 */
export function connect(): Socket {
  if (socket?.connected) return socket;

  const token = getAccessToken();
  if (!token) {
    throw new Error('Cannot connect WebSocket: no access token');
  }

  socket = io(WS_URL, {
    path: '/ws',
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    console.log('[ws] Connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[ws] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[ws] Connection error:', err.message);
    // If auth fails, update token and retry
    if (err.message.includes('token') || err.message.includes('auth')) {
      const newToken = getAccessToken();
      if (newToken && socket) {
        socket.auth = { token: newToken };
      }
    }
  });

  // Register all existing event handlers
  for (const [event, eventHandlers] of handlers) {
    for (const handler of eventHandlers) {
      socket.on(event, handler);
    }
  }

  return socket;
}

/**
 * Disconnect from the WebSocket server.
 */
export function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Subscribe to a WebSocket event.
 * Returns an unsubscribe function.
 */
export function subscribe(event: WsEventType, handler: EventHandler): () => void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
  }
  handlers.get(event)!.add(handler);

  // Register on active socket
  if (socket) {
    socket.on(event, handler);
  }

  return () => {
    handlers.get(event)?.delete(handler);
    if (socket) {
      socket.off(event, handler);
    }
  };
}

/**
 * Check if currently connected.
 */
export function isConnected(): boolean {
  return socket?.connected ?? false;
}
