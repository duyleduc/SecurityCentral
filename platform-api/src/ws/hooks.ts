/**
 * WebSocket event hooks — call these from services to broadcast real-time events.
 * All events are org-scoped (only clients in the same org receive them).
 *
 * Each hook also dispatches to the notification system (email/Slack/webhook)
 * for events that subscribers care about. WebSocket = in-app real-time;
 * notifications = out-of-band alerting.
 */

import { broadcastToOrg } from './server.js';
import { dispatch } from '../lib/notifications/dispatcher.js';
import { env } from '../lib/env.js';

const dashboardBase = (): string => env.DASHBOARD_BASE_URL.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Finding events
// ---------------------------------------------------------------------------

export function emitFindingNew(orgId: string, finding: { id: string; title: string; severity: string; source: string }): void {
  broadcastToOrg(orgId, 'finding:new', finding);
  void dispatch({
    orgId,
    event: 'finding:new',
    title: finding.title,
    severity: finding.severity as 'critical' | 'high' | 'medium' | 'low' | 'info',
    description: `Source: ${finding.source}`,
    url: `${dashboardBase()}/findings/${finding.id}`,
    data: finding,
  });
}

export function emitFindingResolved(orgId: string, finding: { id: string; title: string }): void {
  broadcastToOrg(orgId, 'finding:resolved', finding);
  void dispatch({
    orgId,
    event: 'finding:resolved',
    title: `Resolved: ${finding.title}`,
    severity: 'info',
    url: `${dashboardBase()}/findings/${finding.id}`,
    data: finding,
  });
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
  void dispatch({
    orgId,
    event: 'scan:completed',
    title: `Scan completed${scan.findingsTotal > 0 ? ` — ${scan.findingsTotal} findings` : ''}`,
    severity: scan.findingsTotal > 0 ? 'medium' : 'info',
    description: `Status: ${scan.status}`,
    url: scan.repositoryId ? `${dashboardBase()}/repositories/${scan.repositoryId}` : `${dashboardBase()}/findings`,
    data: scan,
  });
}

// ---------------------------------------------------------------------------
// Agent / Server events
// ---------------------------------------------------------------------------

export function emitAgentConnected(orgId: string, server: { id: string; hostname: string }): void {
  broadcastToOrg(orgId, 'agent:connected', server);
  void dispatch({
    orgId,
    event: 'agent:connected',
    title: `Agent connected: ${server.hostname}`,
    severity: 'info',
    url: `${dashboardBase()}/servers/${server.id}`,
    data: server,
  });
}

export function emitAgentDisconnected(orgId: string, server: { id: string; hostname: string }): void {
  broadcastToOrg(orgId, 'agent:disconnected', server);
  void dispatch({
    orgId,
    event: 'agent:disconnected',
    title: `Server offline: ${server.hostname}`,
    severity: 'high',
    description: 'No heartbeat received within the offline threshold. The server may be down or unreachable.',
    url: `${dashboardBase()}/servers/${server.id}`,
    data: server,
  });
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
  const severity: 'critical' | 'high' | 'medium' = endpoint.daysLeft <= 3 ? 'critical' : endpoint.daysLeft <= 14 ? 'high' : 'medium';
  void dispatch({
    orgId,
    event: 'cert:expiring',
    title: `SSL certificate expiring: ${endpoint.host} (${endpoint.daysLeft} days)`,
    severity,
    description: `The SSL certificate for ${endpoint.host} will expire in ${endpoint.daysLeft} days. Renew before expiry to avoid service disruption.`,
    url: `${dashboardBase()}/monitoring/${endpoint.id}`,
    data: endpoint,
  });
}

export function emitEndpointStatusChange(orgId: string, data: { endpointId: string; previousStatus: string; newStatus: string }): void {
  broadcastToOrg(orgId, 'endpoint:status-change', data);
}

// ---------------------------------------------------------------------------
// Brute force / CVE — dedicated alerting events
// ---------------------------------------------------------------------------

export function emitBruteForceActive(orgId: string, data: { hostname: string; serverId: string; sshVelocity: number; sshUniqueIps: number }): void {
  void dispatch({
    orgId,
    event: 'brute_force:active',
    title: `Active SSH brute force on ${data.hostname}`,
    severity: 'critical',
    description: `${data.sshVelocity} failed SSH attempts in the last 5 minutes from ${data.sshUniqueIps} unique IPs. Consider blocking offending IPs immediately.`,
    url: `${dashboardBase()}/servers/${data.serverId}`,
    data,
  });
}

export function emitCveCritical(orgId: string, data: { hostname: string; serverId: string; cveCount: number; topCve?: string }): void {
  void dispatch({
    orgId,
    event: 'cve:critical',
    title: `${data.cveCount} critical CVE${data.cveCount > 1 ? 's' : ''} found on ${data.hostname}`,
    severity: 'critical',
    description: data.topCve ? `Including ${data.topCve}. Run package updates and review the Vulnerabilities tab.` : 'Run package updates and review the Vulnerabilities tab.',
    url: `${dashboardBase()}/servers/${data.serverId}`,
    data,
  });
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export function emitAuditLog(orgId: string, entry: { action: string; entityType: string; entityId?: string; actorId?: string }): void {
  broadcastToOrg(orgId, 'audit:new', entry);
}
