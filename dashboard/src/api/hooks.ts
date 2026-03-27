// ---------------------------------------------------------------------------
// React Query hooks for all API endpoints
// ---------------------------------------------------------------------------

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete, type ApiEnvelope } from './client.js';

// ---------------------------------------------------------------------------
// Types (mirrors platform-api models)
// ---------------------------------------------------------------------------

export interface Finding {
  id: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  description?: string;
  cveId?: string;
  cvssScore?: number;
  repositoryId?: string;
  serverId?: string;
  certificateId?: string;
  autoFixable: boolean;
  firstSeenAt: string;
  resolvedAt?: string;
}

export interface Repository {
  id: string;
  provider: string;
  owner: string;
  name: string;
  defaultBranch: string;
  language?: string;
  lastScanAt?: string;
}

export interface Server {
  id: string;
  hostname: string;
  osFamily: string;
  osVersion: string;
  environment: string;
  status: string;
  lastHeartbeat?: string;
  agentVersion?: string;
  openFindingCount?: number;
}

export interface Certificate {
  id: string;
  subjectCn: string;
  sans: string[];
  issuerCn: string;
  notAfter: string;
  status: string;
  keyAlgorithm: string;
}

export interface Scan {
  id: string;
  scanType: string;
  status: string;
  trigger: string;
  findingsTotal: number;
  findingsNew: number;
  findingsResolved: number;
  startedAt?: string;
  completedAt?: string;
}

export interface DashboardSummary {
  findings: { total: number; by_severity: Record<string, number>; open: number; resolved: number };
  assets: { repositories: number; servers: number; certificates: number };
}

export interface TopRisk extends Finding {
  repository?: { name: string };
  server?: { hostname: string };
  certificate?: { subjectCn: string };
}

export interface AssetsOverview {
  repositories: { total: number; affected: number; health_pct: number };
  servers: { total: number; affected: number; health_pct: number };
  certificates: { total: number; affected: number; health_pct: number };
}

export interface TrendPoint {
  date: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Paginated query params
// ---------------------------------------------------------------------------

interface PaginatedParams {
  page?: number;
  per_page?: number;
  [key: string]: string | number | undefined;
}

function toStringParams(params?: PaginatedParams): Record<string, string> | undefined {
  if (!params) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) result[k] = String(v);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function useFindings(params?: PaginatedParams & { severity?: string; status?: string; q?: string }) {
  return useQuery({
    queryKey: ['findings', params],
    queryFn: () => apiGet<Finding[]>('/findings', toStringParams(params)),
  });
}

export function useFinding(id: string) {
  return useQuery({
    queryKey: ['findings', id],
    queryFn: () => apiGet<Finding>(`/findings/${id}`),
    enabled: !!id,
  });
}

export function useUpdateFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiPatch<Finding>(`/findings/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['findings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useFindingsStats() {
  return useQuery({
    queryKey: ['findings', 'stats'],
    queryFn: () => apiGet<Record<string, unknown>>('/findings/stats'),
  });
}

export function useFindingsTrends(params?: { interval?: string; days?: number }) {
  return useQuery({
    queryKey: ['findings', 'trends', params],
    queryFn: () => apiGet<{ new_findings: TrendPoint[]; resolved_findings: TrendPoint[] }>('/findings/trends', toStringParams(params as PaginatedParams)),
  });
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export function useRepositories(params?: PaginatedParams) {
  return useQuery({
    queryKey: ['repositories', params],
    queryFn: () => apiGet<Repository[]>('/repositories', toStringParams(params)),
  });
}

export function useRepository(id: string) {
  return useQuery({
    queryKey: ['repositories', id],
    queryFn: () => apiGet<Repository>(`/repositories/${id}`),
    enabled: !!id,
  });
}

export function useTriggerScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => apiPost<Scan>(`/repositories/${repoId}/scan`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scans'] }),
  });
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export function useServers(params?: PaginatedParams & { status?: string; environment?: string }) {
  return useQuery({
    queryKey: ['servers', params],
    queryFn: () => apiGet<Server[]>('/servers', toStringParams(params)),
  });
}

export function useServer(id: string) {
  return useQuery({
    queryKey: ['servers', id],
    queryFn: () => apiGet<Server>(`/servers/${id}`),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export function useCertificates(params?: PaginatedParams & { status?: string }) {
  return useQuery({
    queryKey: ['certificates', params],
    queryFn: () => apiGet<Certificate[]>('/certificates', toStringParams(params)),
  });
}

export function useCertificate(id: string) {
  return useQuery({
    queryKey: ['certificates', id],
    queryFn: () => apiGet<Certificate>(`/certificates/${id}`),
    enabled: !!id,
  });
}

export function useExpiringCertificates(days = 30) {
  return useQuery({
    queryKey: ['certificates', 'expiring', days],
    queryFn: () => apiGet<Certificate[]>('/certificates/expiring', { days: String(days) }),
  });
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

export function useScans(params?: PaginatedParams & { status?: string; scan_type?: string }) {
  return useQuery({
    queryKey: ['scans', params],
    queryFn: () => apiGet<Scan[]>('/scans', toStringParams(params)),
  });
}

export function useScan(id: string) {
  return useQuery({
    queryKey: ['scans', id],
    queryFn: () => apiGet<Scan>(`/scans/${id}`),
    enabled: !!id,
  });
}

export function useCancelScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scanId: string) => apiPost<Scan>(`/scans/${scanId}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scans'] }),
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => apiGet<DashboardSummary>('/dashboard/summary'),
    staleTime: 30_000,
  });
}

export function useDashboardTopRisks() {
  return useQuery({
    queryKey: ['dashboard', 'top-risks'],
    queryFn: () => apiGet<TopRisk[]>('/dashboard/top-risks'),
    staleTime: 60_000,
  });
}

export function useDashboardAssets() {
  return useQuery({
    queryKey: ['dashboard', 'assets'],
    queryFn: () => apiGet<AssetsOverview>('/dashboard/assets-overview'),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Provider Repo Discovery
// ---------------------------------------------------------------------------

export interface DiscoveredRepo {
  provider_id: string;
  full_name: string;
  name: string;
  owner: string;
  default_branch: string;
  language: string | null;
  visibility: string;
  updated_at: string;
  synced: boolean;
}

export function useProviderRepos(provider: string, params?: { search?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ['provider-repos', provider, params],
    queryFn: () => apiGet<DiscoveredRepo[]>(`/integrations/${provider}/repos`, toStringParams(params as PaginatedParams)),
    enabled: !!provider,
  });
}

export function useSyncRepos(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoIds: string[]) =>
      apiPost<{ synced: number; errors: string[] }>(`/integrations/${provider}/repos/sync`, { repo_ids: repoIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-repos', provider] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}

export function useUnsyncRepo(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      apiDelete(`/integrations/${provider}/repos/${providerId}/sync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-repos', provider] });
      qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Cloud Infrastructure Discovery
// ---------------------------------------------------------------------------

export interface CloudResource {
  id: string;
  provider: string;
  resourceType: string;
  resourceId: string;
  hostname: string | null;
  ipAddress: string | null;
  region: string | null;
  status: string | null;
  osInfo: string | null;
  server: { id: string; hostname: string; agentVersion: string | null; lastHeartbeat: string | null; status: string } | null;
}

export interface CoverageStats {
  total_instances: number;
  total_monitored: number;
  overall_coverage_pct: number;
  breakdown: Array<{ provider: string; region: string; total: number; monitored: number; coverage_pct: number }>;
}

export function useCloudResources(provider: string, params?: { page?: number; per_page?: number; region?: string; status?: string }) {
  return useQuery({
    queryKey: ['cloud-resources', provider, params],
    queryFn: () => apiGet<CloudResource[]>(`/integrations/${provider}/resources`, toStringParams(params as PaginatedParams)),
    enabled: !!provider,
  });
}

export function useUnmonitoredServers() {
  return useQuery({
    queryKey: ['unmonitored-servers'],
    queryFn: () => apiGet<CloudResource[]>('/integrations/servers/unmonitored'),
  });
}

export function useCoverageStats() {
  return useQuery({
    queryKey: ['coverage-stats'],
    queryFn: () => apiGet<CoverageStats>('/integrations/coverage/stats'),
    staleTime: 30_000,
  });
}

export function useConnectCloud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: Record<string, unknown> }) =>
      apiPost(`/integrations/${provider}`, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      qc.invalidateQueries({ queryKey: ['coverage-stats'] });
    },
  });
}

export function useTriggerDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      apiPost(`/integrations/${provider}/discover`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cloud-resources'] });
      qc.invalidateQueries({ queryKey: ['coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['unmonitored-servers'] });
    },
  });
}
