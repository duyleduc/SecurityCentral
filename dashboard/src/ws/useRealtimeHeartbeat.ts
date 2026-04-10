import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, connectSocket } from './client';

interface HeartbeatEvent {
  endpointId: string;
  isUp: boolean;
  statusCode?: number;
  responseMs: number;
  error?: string;
  status: string;
  timestamp: string;
}

/**
 * Subscribe to real-time heartbeat events via Socket.IO.
 * Automatically invalidates React Query caches when new data arrives.
 */
export function useRealtimeHeartbeat(endpointId?: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    let socket = getSocket();
    if (!socket) {
      try {
        socket = connectSocket();
        console.log('[ws] connected for heartbeat subscription');
      } catch (err) {
        console.warn('[ws] failed to connect:', err);
        return;
      }
    }

    const handleHeartbeat = (data: HeartbeatEvent) => {
      console.log('[ws] heartbeat received', {
        endpointId: data.endpointId,
        isUp: data.isUp,
        responseMs: data.responseMs,
        status: data.status,
      });

      // If watching a specific endpoint, only react to that one
      if (endpointId && data.endpointId !== endpointId) return;

      // Invalidate relevant queries so UI updates
      qc.invalidateQueries({ queryKey: ['endpoints'] });
      if (endpointId) {
        qc.invalidateQueries({ queryKey: ['endpoints', endpointId] });
        qc.invalidateQueries({ queryKey: ['heartbeats', endpointId] });
      }
    };

    const handleStatusChange = (data: { endpointId: string; previousStatus: string; newStatus: string }) => {
      console.log('[ws] status changed', data);
      qc.invalidateQueries({ queryKey: ['endpoints'] });
    };

    socket.on('heartbeat', handleHeartbeat);
    socket.on('endpoint:status-change', handleStatusChange);

    return () => {
      socket?.off('heartbeat', handleHeartbeat);
      socket?.off('endpoint:status-change', handleStatusChange);
    };
  }, [qc, endpointId]);
}
