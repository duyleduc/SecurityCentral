import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  _count?: { servers: number; monitoredEndpoints: number };
}

export interface MonitoredEndpoint {
  id: string;
  host: string;
  port: number;
  protocol: string;
  status: string;
  checkInterval: string;
  lastCheckAt: string | null;
  project?: { id: string; name: string } | null;
  heartbeats?: EndpointHeartbeat[];
}

export interface EndpointHeartbeat {
  id: string;
  isUp: boolean;
  statusCode: number | null;
  responseMs: number | null;
  sslValid: boolean | null;
  sslExpiry: string | null;
  sslIssuer: string | null;
  sslDaysLeft: number | null;
  tlsVersion: string | null;
  dnsSpf: string | null;
  dnsDkim: string | null;
  dnsDmarc: string | null;
  error: string | null;
  createdAt: string;
}

export interface DomainCheckResult {
  ssl: {
    valid: boolean;
    issuer: string;
    expiry: string;
    daysLeft: number;
    tlsVersion: string;
    error?: string;
  } | null;
  http: {
    isUp: boolean;
    statusCode: number | null;
    responseMs: number;
    error?: string;
  };
  dns: {
    spf: string;
    dkim: string;
    dmarc: string;
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient<Project[]>('/api/v1/projects'),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => apiClient<Project>(`/api/v1/projects/${id}`),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiClient<Project>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<void>(`/api/v1/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

// ---------------------------------------------------------------------------
// Monitoring Endpoints
// ---------------------------------------------------------------------------

export function useEndpoints() {
  return useQuery({
    queryKey: ['endpoints'],
    queryFn: () => apiClient<MonitoredEndpoint[]>('/api/v1/monitoring/endpoints'),
  });
}

export function useEndpoint(id: string) {
  return useQuery({
    queryKey: ['endpoints', id],
    queryFn: () => apiClient<MonitoredEndpoint>(`/api/v1/monitoring/endpoints/${id}`),
    enabled: !!id,
  });
}

export function useCreateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { host: string; port?: number; protocol?: string; checkInterval?: string; projectId?: string }) =>
      apiClient<MonitoredEndpoint>('/api/v1/monitoring/endpoints', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['endpoints'] }),
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<void>(`/api/v1/monitoring/endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['endpoints'] }),
  });
}

export function useTriggerCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<DomainCheckResult>(`/api/v1/monitoring/endpoints/${id}/check`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] });
      qc.invalidateQueries({ queryKey: ['heartbeats'] });
    },
  });
}

export function useHeartbeats(endpointId: string, limit = 20) {
  return useQuery({
    queryKey: ['heartbeats', endpointId, limit],
    queryFn: () =>
      apiClient<EndpointHeartbeat[]>(`/api/v1/monitoring/endpoints/${endpointId}/heartbeats?limit=${limit}`),
    enabled: !!endpointId,
  });
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export interface Server {
  id: string;
  hostname: string;
  agentId: string | null;
  agentVersion: string | null;
  osFamily: string | null;
  osVersion: string | null;
  status: string;
  lastHeartbeat: string | null;
  createdAt: string;
  _count?: { metrics: number; findings: number };
  metrics?: ServerMetric[];
}

export interface ServerMetric {
  id: string;
  cpu: number;
  memory: number;
  disk: number;
  urgent: boolean;
  alerts: unknown[];
  createdAt: string;
}

export interface InstallToken {
  id: string;
  rawToken?: string;
  label: string;
  expiresAt: string;
  usedAt: string | null;
  project?: { id: string; name: string } | null;
}

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => apiClient<Server[]>('/api/v1/servers'),
  });
}

export function useServer(id: string) {
  return useQuery({
    queryKey: ['servers', id],
    queryFn: () => apiClient<Server>(`/api/v1/servers/${id}`),
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

export function useServerMetrics(id: string, hours = 24) {
  return useQuery({
    queryKey: ['servers', id, 'metrics', hours],
    queryFn: () => apiClient<ServerMetric[]>(`/api/v1/servers/${id}/metrics?hours=${hours}`),
    enabled: !!id,
    refetchInterval: 15_000,
  });
}

export function useCreateInstallToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label?: string; projectId?: string; expiresInHours?: number }) =>
      apiClient<InstallToken>('/api/v1/install-tokens', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['install-tokens'] }),
  });
}

export function useInstallTokens() {
  return useQuery({
    queryKey: ['install-tokens'],
    queryFn: () => apiClient<InstallToken[]>('/api/v1/install-tokens'),
  });
}
