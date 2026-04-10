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

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export interface Integration {
  id: string;
  provider: 'github' | 'gitlab';
  baseUrl: string | null;
  verifySsl: boolean;
  status: string;
  enabled: boolean;
  createdAt: string;
  _count?: { repositories: number };
}

export interface ProviderRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  language: string | null;
  cloneUrl: string;
  private: boolean;
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiClient<Integration[]>('/api/v1/integrations'),
  });
}

export function useConnectGitHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { installationId: string; appId?: string }) =>
      apiClient<Integration>('/api/v1/integrations/github', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useConnectGitLab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { accessToken: string; baseUrl?: string; verifySsl?: boolean }) =>
      apiClient<Integration>('/api/v1/integrations/gitlab', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useDeleteIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<void>(`/api/v1/integrations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

export function useGitHubRepos(page = 1, perPage = 30) {
  return useQuery({
    queryKey: ['github-repos', page, perPage],
    queryFn: () =>
      apiClient<ProviderRepo[]>(`/api/v1/integrations/github/repos?page=${page}&perPage=${perPage}`),
  });
}

export function useGitLabRepos(page = 1, perPage = 30, search = '') {
  return useQuery({
    queryKey: ['gitlab-repos', page, perPage, search],
    queryFn: () =>
      apiClient<ProviderRepo[]>(
        `/api/v1/integrations/gitlab/repos?page=${page}&perPage=${perPage}&search=${encodeURIComponent(search)}`,
      ),
  });
}

export function useSyncRepos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { provider: string; repos: ProviderRepo[]; projectId?: string }) =>
      apiClient<void>(`/api/v1/integrations/${data.provider}/repos/sync`, {
        method: 'POST',
        body: JSON.stringify({ repos: data.repos, projectId: data.projectId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repositories'] }),
  });
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface Repository {
  id: string;
  provider: 'github' | 'gitlab';
  owner: string;
  name: string;
  defaultBranch: string;
  language: string | null;
  lastScanAt: string | null;
  createdAt: string;
  project?: { id: string; name: string } | null;
  integration?: { id: string; provider: string; status: string } | null;
  _count?: { scans: number; findings: number };
}

export interface Scan {
  id: string;
  type: string;
  status: string;
  trigger: string;
  branch: string | null;
  duration: number | null;
  findingsTotal: number;
  createdAt: string;
  completedAt: string | null;
}

export function useRepositories(projectId?: string, provider?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (provider) params.set('provider', provider);
  const qs = params.toString();
  return useQuery({
    queryKey: ['repositories', { projectId, provider }],
    queryFn: () => apiClient<Repository[]>(`/api/v1/repositories${qs ? `?${qs}` : ''}`),
  });
}

export function useRepository(id: string) {
  return useQuery({
    queryKey: ['repositories', id],
    queryFn: () => apiClient<Repository>(`/api/v1/repositories/${id}`),
    enabled: !!id,
  });
}

export function useDeleteRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<void>(`/api/v1/repositories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repositories'] }),
  });
}

export function useTriggerScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { repoId: string; scanType: string; branch?: string }) =>
      apiClient<Scan>(`/api/v1/repositories/${data.repoId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ scanType: data.scanType, branch: data.branch }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['repository-scans', variables.repoId] });
      qc.invalidateQueries({ queryKey: ['repositories', variables.repoId] });
    },
  });
}

export function useRepositoryScans(repoId: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: ['repository-scans', repoId, page, limit],
    queryFn: () =>
      apiClient<Scan[]>(`/api/v1/repositories/${repoId}/scans?page=${page}&limit=${limit}`),
    enabled: !!repoId,
  });
}
