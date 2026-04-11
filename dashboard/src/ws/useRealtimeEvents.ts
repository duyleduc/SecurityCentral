import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, connectSocket } from './client';

/**
 * Subscribe to all real-time WebSocket events and invalidate relevant React Query caches.
 * Mount this once at the app level (e.g. in AppShell).
 */
export function useRealtimeEvents(): void {
  const qc = useQueryClient();

  useEffect(() => {
    let socket = getSocket();
    if (!socket) {
      try {
        socket = connectSocket();
      } catch {
        return;
      }
    }

    // Findings
    const onFindingNew = () => {
      qc.invalidateQueries({ queryKey: ['findings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };
    const onFindingResolved = () => {
      qc.invalidateQueries({ queryKey: ['findings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };
    const onFindingUpdated = () => {
      qc.invalidateQueries({ queryKey: ['findings'] });
    };

    // Scans
    const onScanStarted = () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
    };
    const onScanCompleted = () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
      qc.invalidateQueries({ queryKey: ['findings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };

    // Agents / Servers
    const onAgentConnected = () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };
    const onAgentDisconnected = () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };
    const onServerMetrics = (data: { serverId: string }) => {
      qc.invalidateQueries({ queryKey: ['servers', data.serverId] });
      qc.invalidateQueries({ queryKey: ['metrics', data.serverId] });
    };

    // Domains
    const onCertExpiring = () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    };
    const onEndpointStatusChange = () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] });
    };

    // Audit
    const onAuditNew = () => {
      qc.invalidateQueries({ queryKey: ['audit-logs'] });
    };

    socket.on('finding:new', onFindingNew);
    socket.on('finding:resolved', onFindingResolved);
    socket.on('finding:updated', onFindingUpdated);
    socket.on('scan:started', onScanStarted);
    socket.on('scan:completed', onScanCompleted);
    socket.on('agent:connected', onAgentConnected);
    socket.on('agent:disconnected', onAgentDisconnected);
    socket.on('server:metrics', onServerMetrics);
    socket.on('cert:expiring', onCertExpiring);
    socket.on('endpoint:status-change', onEndpointStatusChange);
    socket.on('audit:new', onAuditNew);

    return () => {
      socket?.off('finding:new', onFindingNew);
      socket?.off('finding:resolved', onFindingResolved);
      socket?.off('finding:updated', onFindingUpdated);
      socket?.off('scan:started', onScanStarted);
      socket?.off('scan:completed', onScanCompleted);
      socket?.off('agent:connected', onAgentConnected);
      socket?.off('agent:disconnected', onAgentDisconnected);
      socket?.off('server:metrics', onServerMetrics);
      socket?.off('cert:expiring', onCertExpiring);
      socket?.off('endpoint:status-change', onEndpointStatusChange);
      socket?.off('audit:new', onAuditNew);
    };
  }, [qc]);
}
