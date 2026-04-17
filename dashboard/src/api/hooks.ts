import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string;
  notes: string;
  banner: string | null;
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
  details: Record<string, unknown> | null;
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

export function useTagKeys(projectId?: string) {
  return useQuery({
    queryKey: ['tag-keys', projectId],
    queryFn: () => apiClient<string[]>(`/api/v1/projects/${projectId}/tag-keys`),
    enabled: !!projectId,
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; notes?: string; banner?: string | null }) =>
      apiClient<Project>(`/api/v1/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['projects', vars.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
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

export function useEndpoints(filters?: { status?: string; tags?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.tags) params.set('tags', filters.tags);
  const qs = params.toString();
  return useQuery({
    queryKey: ['endpoints', filters?.status ?? '', filters?.tags ?? ''],
    queryFn: () => apiClient<MonitoredEndpoint[]>(`/api/v1/monitoring/endpoints${qs ? `?${qs}` : ''}`),
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
    mutationFn: (data: { host: string; port?: number; protocol?: string; uptimeInterval?: number; uptimeTimeout?: number; projectId?: string; tags?: Array<{ key: string; value: string }> }) =>
      apiClient<MonitoredEndpoint>('/api/v1/monitoring/endpoints', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['endpoints'] }),
  });
}

export function useUpdateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; uptimeInterval?: number; uptimeTimeout?: number }) =>
      apiClient<MonitoredEndpoint>(`/api/v1/monitoring/endpoints/${data.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ uptimeInterval: data.uptimeInterval, uptimeTimeout: data.uptimeTimeout }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] });
    },
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

export function useLatestSslScan(endpointId: string) {
  return useQuery({
    queryKey: ['ssl-scan', endpointId],
    queryFn: () => apiClient<EndpointHeartbeat | null>(`/api/v1/monitoring/endpoints/${endpointId}/ssl-scan`),
    enabled: !!endpointId,
  });
}

export function useTriggerSslScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<any>(`/api/v1/monitoring/endpoints/${id}/ssl-scan`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['endpoints'] });
      qc.invalidateQueries({ queryKey: ['heartbeats'] });
      qc.invalidateQueries({ queryKey: ['ssl-scan', id] });
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
  label: string;
  hostname: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  agentId: string | null;
  agentVersion: string | null;
  osFamily: string | null;
  osVersion: string | null;
  kernel: string | null;
  cpuCores: number | null;
  cpuModel: string | null;
  totalRamMb: number | null;
  totalDiskGb: number | null;
  ipAddresses: string[] | null;
  tags: Array<{ key: string; value: string }>;
  status: string;
  securityScore: number | null;
  lastHeartbeat: string | null;
  createdAt: string;
  _count?: { metrics: number; findings: number };
  metrics?: ServerMetric[];
}

export interface ScoreHistoryEntry {
  score: number;
  breakdown: { critical: number; high: number; medium: number; low: number };
  createdAt: string;
}

export interface ServerMetric {
  id: string;
  cpu: number;
  memory: number;
  disk: number;
  urgent: boolean;
  alerts: unknown[];
  cpuIoWait: number | null;
  swapUsedPct: number | null;
  loadAvg1: number | null;
  loadAvg5: number | null;
  loadAvg15: number | null;
  diskReadBps: number | null;
  diskWriteBps: number | null;
  diskIoUtil: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
  netErrors: number | null;
  docker: {
    running: number;
    stopped: number;
    containers: Array<{
      id: string;
      name: string;
      image: string;
      state: string;
      cpu: number;
      memory: number;
      restarts: number;
    }>;
  } | null;
  createdAt: string;
}

export interface SecurityPosture {
  id: string;
  serverId: string;
  collectedAt: string;
  listeningPorts: Array<{ port: number; proto: string; process: string; bind: string }>;
  sshConfig: { rootLogin: string; passwordAuth: string; port: number; permitEmptyPwd: string };
  firewallActive: boolean;
  firewallType: string;
  loggedInUsers: Array<{ user: string; from: string; since: string }>;
  sshFailures: number;
  shellUsers: string[];
  pendingReboot: boolean;
  openFdAlloc: number | null;
  openFdMax: number | null;
  auditResults: Array<{
    id: string;
    category: string;
    title: string;
    status: 'pass' | 'fail' | 'warn';
    severity: 'critical' | 'high' | 'medium' | 'low';
    detail: string;
    cis: { controlId: string; benchmark: string; title: string; level: number } | null;
  }> | null;
  cisSummary?: { total: number; mapped: number; passing: number; failing: number };
  bruteForce?: {
    sshVelocity: number;
    sshUniqueIps: number;
    sshTopAttackers: Array<{ ip: string; count: number }>;
    sshCompromise: Array<{ ip: string; failuresBefore: number; successUser: string; successAt: string }>;
    httpVelocity: number;
    httpUniqueIps: number;
    isActiveAttack: boolean;
    isDistributed: boolean;
    hasCompromise: boolean;
  };
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

export function useSecurityPosture(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'security-posture'],
    queryFn: () => apiClient<SecurityPosture | null>(`/api/v1/servers/${id}/security-posture`),
    enabled: !!id,
    refetchInterval: 60_000,
  });
}

export interface CveFinding {
  id: string;
  cveId: string | null;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  cvssScore: number | null;
  detail: { packageName?: string; installedVersion?: string; fixedVersion?: string | null; cisaKev?: boolean; epss?: number | null; epssPercentile?: number | null; remediation?: string | null } | null;
  createdAt: string;
}

export interface CveScanResult {
  matched: number;
  created: number;
  resolved: number;
  packages: number;
  osFamily: string;
  scannedAt: string;
}

export function useTriggerCveScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      apiClient<CveScanResult>(`/api/v1/servers/${serverId}/scan-cve`, { method: 'POST' }),
    onSuccess: (_data, serverId) => {
      qc.invalidateQueries({ queryKey: ['servers', serverId, 'vulnerabilities'] });
    },
  });
}

export function useServerVulnerabilities(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'vulnerabilities'],
    queryFn: () => apiClient<CveFinding[]>(`/api/v1/servers/${id}/vulnerabilities`),
    enabled: !!id,
    refetchInterval: 60_000,
  });
}

export function useScoreHistory(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'score-history'],
    queryFn: () => apiClient<ScoreHistoryEntry[]>(`/api/v1/servers/${id}/score-history`),
    enabled: !!id,
  });
}

export interface AttackSurfaceScan {
  id: string;
  targetIp: string;
  status: string;
  openPorts: Array<{ port: number; service: string; version: string | null; banner: string | null; riskLevel: string; isDatabase: boolean; responseMs: number }> | null;
  adminPanels: Array<{ port: number; path: string; status: number }> | null;
  summary: { totalOpen: number; critical: number; high: number; medium: number; low: number; adminPanels: number } | null;
  completedAt: string | null;
  createdAt: string;
}

export function useAttackSurfaceScan(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'attack-surface-scan'],
    queryFn: () => apiClient<AttackSurfaceScan | null>(`/api/v1/servers/${id}/attack-surface-scan`),
    enabled: !!id,
    refetchInterval: 10_000, // poll while scan is running
  });
}

export function useTriggerAttackSurfaceScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      apiClient<{ scanId: string; targetIp: string }>(`/api/v1/servers/${serverId}/attack-surface-scan`, {
        method: 'POST',
        body: JSON.stringify({ checkAdminPanels: true }),
      }),
    onSuccess: (_data, serverId) => {
      qc.invalidateQueries({ queryKey: ['servers', serverId, 'attack-surface-scan'] });
    },
  });
}

export interface PackageInventory {
  id: string;
  serverId: string;
  collectedAt: string;
  osFamily: string;
  packages: Array<{ name: string; version: string; arch?: string }>;
  pendingSecurityUpdates: number;
  kernelRunning: string | null;
  kernelInstalled: string | null;
  unattendedUpgrades: boolean;
}

export function usePackageInventory(id: string) {
  return useQuery({
    queryKey: ['servers', id, 'packages'],
    queryFn: () => apiClient<PackageInventory | null>(`/api/v1/servers/${id}/packages`),
    enabled: !!id,
    refetchInterval: 60_000,
  });
}

export function useAgentLatestVersion() {
  return useQuery({
    queryKey: ['agent-version'],
    queryFn: () => apiClient<{ version: string; changelog: string }>('/v1/agents/version'),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; hostname?: string; projectId?: string | null; tags?: Array<{ key: string; value: string }> }) =>
      apiClient<Server>(`/api/v1/servers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      qc.invalidateQueries({ queryKey: ['servers', vars.id] });
    },
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<{ deleted: boolean; hostname: string; agentId: string | null }>(`/api/v1/servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useCreateInstallToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label?: string; projectId?: string; expiresInHours?: number; tags?: Array<{ key: string; value: string }> }) =>
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
        body: JSON.stringify({
          repos: data.repos.map((r) => ({
            providerId: String(r.id),
            name: r.name,
            owner: r.owner,
            defaultBranch: r.defaultBranch,
            language: r.language,
            cloneUrl: r.cloneUrl,
            private: r.private,
          })),
          projectId: data.projectId,
        }),
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

export function useScanFindings(repoId: string, scanId: string | null) {
  return useQuery({
    queryKey: ['scan-findings', scanId],
    queryFn: () => apiClient<Array<{
      id: string; severity: string; status: string; title: string;
      cveId: string | null; cvssScore: number | null; source: string;
      detail: Record<string, unknown> | null; createdAt: string;
    }>>(`/api/v1/repositories/${repoId}/scans/${scanId}/findings`),
    enabled: !!scanId,
  });
}

export function useClearScanHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      apiClient<void>(`/api/v1/repositories/${repoId}/scans`, { method: 'DELETE' }),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ['repository-scans', repoId] });
      qc.invalidateQueries({ queryKey: ['repositories', repoId] });
      qc.invalidateQueries({ queryKey: ['findings'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  assets: { projects: number; repositories: number; servers: number; domains: number };
  findings: { critical: number; high: number; medium: number; low: number; info: number; total: number; last7Days: number };
  score: { score: number; breakdown: Array<{ severity: string; count: number; deduction: number }> };
}

export interface DashboardAsset {
  id: string;
  type: 'repository' | 'server' | 'endpoint';
  score: { score: number; breakdown: Array<{ severity: string; count: number; deduction: number }> };
  [key: string]: unknown;
}

export interface Finding {
  id: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  cveId: string | null;
  cvssScore: number | null;
  createdAt: string;
  repository?: { id: string; owner: string; name: string } | null;
  server?: { id: string; hostname: string } | null;
}

export interface FindingsFilters {
  severity?: string;
  status?: string;
  source?: string;
  repositoryId?: string;
  serverId?: string;
  page?: number;
  limit?: number;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/v1/dashboard/summary'),
  });
}

export function useDashboardTopRisks() {
  return useQuery({
    queryKey: ['dashboard', 'top-risks'],
    queryFn: () => apiClient<Finding[]>('/api/v1/dashboard/top-risks'),
  });
}

export function useDashboardAssets() {
  return useQuery({
    queryKey: ['dashboard', 'assets'],
    queryFn: () => apiClient<DashboardAsset[]>('/api/v1/dashboard/assets'),
  });
}

export function useFindings(filters: FindingsFilters = {}) {
  const params = new URLSearchParams();
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.status) params.set('status', filters.status);
  if (filters.source) params.set('source', filters.source);
  if (filters.repositoryId) params.set('repositoryId', filters.repositoryId);
  if (filters.serverId) params.set('serverId', filters.serverId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['findings', filters],
    queryFn: () => apiClient<Finding[]>(`/api/v1/findings${qs ? `?${qs}` : ''}`),
  });
}

export function useFinding(id: string) {
  return useQuery({
    queryKey: ['findings', id],
    queryFn: () => apiClient<Finding>(`/api/v1/findings/${id}`),
    enabled: !!id,
  });
}

export function useUpdateFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; status: string }) =>
      apiClient<Finding>(`/api/v1/findings/${data.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: data.status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['findings'] }),
  });
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export function useOrganization() {
  return useQuery({
    queryKey: ['organization'],
    queryFn: () => apiClient<any>('/api/v1/organization'),
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      apiClient<any>('/api/v1/organization', { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization'] }),
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ['organization', 'members'],
    queryFn: () => apiClient<any[]>('/api/v1/organization/members'),
  });
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export function useApiKeys() {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient<any[]>('/api/v1/api-keys'),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; expiresInDays?: number }) =>
      apiClient<any>('/api/v1/api-keys', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<any>(`/api/v1/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

// ---------------------------------------------------------------------------
// Notification Preferences
// ---------------------------------------------------------------------------

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiClient<any[]>('/api/v1/notifications/preferences'),
  });
}

export function useUpsertNotificationPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { channel: string; eventType: string; enabled: boolean }) =>
      apiClient<any>('/api/v1/notifications/preferences', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });
}

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

export function useAuditLogs(page = 1, limit = 50) {
  return useQuery({
    queryKey: ['audit-logs', page, limit],
    queryFn: () => apiClient<any[]>(`/api/v1/audit-logs?page=${page}&limit=${limit}`),
  });
}
