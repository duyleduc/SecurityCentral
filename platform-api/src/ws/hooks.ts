/**
 * WebSocket event hooks — call these from services to broadcast real-time events.
 * All events are org-scoped (only clients in the same org receive them).
 */

import { broadcastToOrg } from './server.js';

// ---------------------------------------------------------------------------
// Finding events
// ---------------------------------------------------------------------------

export function emitFindingNew(orgId: string, finding: { id: string; title: string; severity: string; source: string }): void {
  broadcastToOrg(orgId, 'finding:new', finding);
}

export function emitFindingResolved(orgId: string, finding: { id: string; title: string }): void {
  broadcastToOrg(orgId, 'finding:resolved', finding);
}

export function emitFindingUpdated(orgId: string, finding: { id: string; status: string }): void {
  broadcastToOrg(orgId, 'finding:updated', finding);
}

// ---------------------------------------------------------------------------
// Scan events
// ---------------------------------------------------------------------------

export function emitScanStarted(orgId: string, scan: { id: string; repositoryId?: string; type: string }): void {
  broadcastToOrg(orgId, 'scan:started', scan);
}

export function emitScanCompleted(orgId: string, scan: { id: string; repositoryId?: string; findingsTotal: number; status: string }): void {
  broadcastToOrg(orgId, 'scan:completed', scan);
}

// ---------------------------------------------------------------------------
// Agent / Server events
// ---------------------------------------------------------------------------

export function emitAgentConnected(orgId: string, server: { id: string; hostname: string }): void {
  broadcastToOrg(orgId, 'agent:connected', server);
}

export function emitAgentDisconnected(orgId: string, server: { id: string; hostname: string }): void {
  broadcastToOrg(orgId, 'agent:disconnected', server);
}

export function emitServerMetrics(orgId: string, data: {
  serverId: string; cpu: number; memory: number; disk: number; urgent: boolean;
  cpuIoWait?: number; swapUsedPct?: number; loadAvg1?: number;
  diskReadBps?: number; diskWriteBps?: number; diskIoUtil?: number;
  netRxBps?: number; netTxBps?: number;
}): void {
  broadcastToOrg(orgId, 'server:metrics', data);
}

// ---------------------------------------------------------------------------
// Domain / SSL events
// ---------------------------------------------------------------------------

export function emitCertExpiring(orgId: string, endpoint: { id: string; host: string; daysLeft: number }): void {
  broadcastToOrg(orgId, 'cert:expiring', endpoint);
}

export function emitEndpointStatusChange(orgId: string, data: { endpointId: string; previousStatus: string; newStatus: string }): void {
  broadcastToOrg(orgId, 'endpoint:status-change', data);
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export function emitAuditLog(orgId: string, entry: { action: string; entityType: string; entityId?: string; actorId?: string }): void {
  broadcastToOrg(orgId, 'audit:new', entry);
}
