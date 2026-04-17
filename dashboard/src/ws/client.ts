import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '../api/client';
import { API_BASE } from '../config';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  const token = getAccessToken();
  if (!token) throw new Error('No access token for WebSocket');

  socket = io(API_BASE || window.location.origin, {
    path: '/ws',
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    console.debug('[ws] connected');
  });

  socket.on('disconnect', (reason) => {
    console.debug('[ws] disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.debug('[ws] connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
