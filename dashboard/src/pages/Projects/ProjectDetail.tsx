import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, Stack, Paper, Skeleton,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Alert, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, InputAdornment, CircularProgress, LinearProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CodeIcon from '@mui/icons-material/Code';
import SearchIcon from '@mui/icons-material/Search';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ScheduleIcon from '@mui/icons-material/Schedule';
import HistoryIcon from '@mui/icons-material/History';
import CancelIcon from '@mui/icons-material/Cancel';
import SecurityIcon from '@mui/icons-material/Security';
import BugReportIcon from '@mui/icons-material/BugReport';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LanguageIcon from '@mui/icons-material/Language';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DnsIcon from '@mui/icons-material/Dns';
import HttpsIcon from '@mui/icons-material/Https';
import {
  useProject, useProjectSummary, useRepositories, useAssignRepoToProject, useRemoveRepoFromProject,
  useDecommissionServer,
  useDeleteProject, useUpdateProject, useTriggerScan, useProjectScans, useCancelScan, useDeleteScan,
  useClearProjectScanHistory, useMonitoredEndpoints, useAddEndpoints, useRemoveEndpoint,
  useTriggerEndpointCheck, useUpdateEndpoint, useFindings,
  type Repository, type Project, type Server, type Scan, type ScanTypeOption, type MonitoredEndpoint,
  type ProjectSummary, type Finding,
} from '../../api/hooks.js';
import AddServerDialog from '../../components/AddServerDialog.js';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../theme/theme.js';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  completed: 'success', failed: 'error', running: 'warning', pending: 'info', cancelled: 'default',
};

function formatDuration(ms?: number | null): string {
  if (!ms) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return '--';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ===========================================================================
// Main component
// ===========================================================================

export function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const summary = useProjectSummary(projectId);
  const deleteMutation = useDeleteProject();
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const data = project.data?.data as (Project & { repositories: Repository[]; servers: Server[] }) | undefined;
  const repos = data?.repositories ?? [];
  const repoIds = repos.map((r) => r.id);
  const projectServers = data?.servers ?? [];
  const stats = summary.data?.data as ProjectSummary | undefined;
  const scansQuery = useProjectScans(projectId, repoIds);
  const totalScans = ((scansQuery.data?.data ?? []) as Scan[]).length;

  const handleDelete = () => {
    if (confirm(`Delete "${data?.name}"? Assets won't be deleted.`)) {
      deleteMutation.mutate(projectId, { onSuccess: () => navigate('/projects') });
    }
  };

  if (project.isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={100} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={300} />
      </Box>
    );
  }

  if (!data) {
    return (
      <Box>
        <Button component={Link} to="/projects" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
          Back to Projects
        </Button>
        <Alert severity="error">Project not found</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Button component={Link} to="/projects" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
        Back to Projects
      </Button>

      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4">{data.name}</Typography>
          {data.description && (
            <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>{data.description}</Typography>
          )}
        </Box>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Edit project">
            <IconButton onClick={() => setEditOpen(true)}>
              <EditIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete project">
            <IconButton color="error" onClick={handleDelete}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Summary Cards */}
      <SummaryCards stats={stats} loading={summary.isLoading} projectId={projectId} />

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Overview" />
        <Tab label={`Repositories (${repos.length})`} />
        <Tab label={`Servers (${projectServers.length})`} />
        <Tab label={`Scans (${totalScans})`} />
        <Tab label={`Domains (${stats?.assets.endpoints ?? 0})`} />
        <Tab label={`Findings (${stats?.totalOpenFindings ?? 0})`} />
      </Tabs>

      {/* Tab content */}
      {tab === 0 && <OverviewTab stats={stats} loading={summary.isLoading} projectId={projectId} repos={repos} repoIds={repoIds} />}
      {tab === 1 && (
        <Box>
          <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddRepoOpen(true)}>
              Add Repository
            </Button>
          </Stack>
          {repos.length === 0 ? (
            <Paper sx={{ py: 5, textAlign: 'center' }}>
              <CodeIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary" sx={{ mb: 2 }}>No repositories in this project yet</Typography>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddRepoOpen(true)}>Add Repository</Button>
            </Paper>
          ) : (
            <RepoTable repos={repos} projectId={projectId} />
          )}
        </Box>
      )}
      {tab === 2 && <ServersSection projectId={projectId} servers={projectServers} />}
      {tab === 3 && <ScanHistory projectId={projectId} repoIds={repoIds} />}
      {tab === 4 && <DomainMonitoringSection projectId={projectId} />}
      {tab === 5 && <FindingsTab projectId={projectId} />}

      <AddRepoDialog
        open={addRepoOpen}
        projectId={projectId}
        existingRepoIds={new Set(repoIds)}
        onClose={() => setAddRepoOpen(false)}
      />

      <EditProjectDialog
        open={editOpen}
        project={data}
        onClose={() => setEditOpen(false)}
      />
    </Box>
  );
}

// ===========================================================================
// Summary cards
// ===========================================================================

function SummaryCards({ stats, loading, projectId }: { stats?: ProjectSummary; loading: boolean; projectId: string }) {
  if (loading || !stats) {
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 2, mb: 3 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={90} />
        ))}
      </Box>
    );
  }

  const { severity, totalOpenFindings, assets, lastScan, activeScans } = stats;
  const hasCritical = (severity.critical ?? 0) > 0;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 2, mb: 3 }}>
      {/* Open Issues */}
      <Paper variant="outlined" sx={{ p: 2, borderColor: hasCritical ? '#d32f2f' : undefined }}>
        <Typography variant="caption" color="text.secondary">Open Issues</Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color: hasCritical ? '#d32f2f' : totalOpenFindings > 0 ? '#f57c00' : '#16a34a' }}>
          {totalOpenFindings}
        </Typography>
        {activeScans > 0 && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">{activeScans} scan{activeScans > 1 ? 's' : ''} running</Typography>
          </Stack>
        )}
      </Paper>

      {/* Severity Breakdown — Pie Chart */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">By Severity</Typography>
        {totalOpenFindings === 0 ? (
          <Box sx={{ py: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">No open issues</Typography>
          </Box>
        ) : (
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 80, height: 80, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(['critical', 'high', 'medium', 'low'] as const)
                      .map((s) => ({ name: s, value: severity[s] ?? 0 }))
                      .filter((d) => d.value > 0)}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={18}
                    outerRadius={36}
                    strokeWidth={1}
                  >
                    {(['critical', 'high', 'medium', 'low'] as const)
                      .filter((s) => (severity[s] ?? 0) > 0)
                      .map((s) => (
                        <Cell key={s} fill={SEVERITY_COLORS[s]} />
                      ))}
                  </Pie>
                  <RechartsTooltip formatter={(value: unknown, name: unknown) => {
                    const v = Number(value);
                    const n = String(name);
                    const pct = totalOpenFindings > 0 ? ((v / totalOpenFindings) * 100).toFixed(1) : '0';
                    return [`${v} (${pct}%)`, n.charAt(0).toUpperCase() + n.slice(1)];
                  }} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Stack spacing={0.25} sx={{ flex: 1 }}>
              {(['critical', 'high', 'medium', 'low'] as const).map((s) => {
                const count = severity[s] ?? 0;
                if (count === 0) return null;
                return (
                  <Stack key={s} direction="row" spacing={0.75} alignItems="center">
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SEVERITY_COLORS[s], flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ textTransform: 'capitalize', flex: 1 }}>{s}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>{count}</Typography>
                  </Stack>
                );
              })}
            </Stack>
          </Stack>
        )}
      </Paper>

      {/* Assets */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">Assets</Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CodeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2">{assets.repositories} Repositories</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <DnsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2">{assets.servers} Servers</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <LanguageIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2">{assets.endpoints} Endpoints</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <HttpsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2">{assets.certificates} Certificates</Typography>
          </Stack>
        </Stack>
      </Paper>

      {/* Last Scan */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">Last Scan</Typography>
        {lastScan ? (
          <>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{timeAgo(lastScan.completedAt)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {lastScan.scanType.replace(/_/g, ' ')} &middot; {lastScan.findingsTotal} findings
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>No scans yet</Typography>
        )}
      </Paper>
    </Box>
  );
}

// ===========================================================================
// Overview tab
// ===========================================================================

function OverviewTab({ stats, loading, projectId, repos, repoIds }: {
  stats?: ProjectSummary; loading: boolean; projectId: string; repos: Repository[]; repoIds: string[];
}) {
  const navigate = useNavigate();
  const scansQuery = useProjectScans(projectId, repoIds);
  const scans = ((scansQuery.data?.data ?? []) as Scan[]);
  const activeScans = scans.filter((s) => s.status === 'pending' || s.status === 'running');
  const recentScans = scans.filter((s) => s.status !== 'pending' && s.status !== 'running').slice(0, 5);

  return (
    <Box>
      {/* Active scans */}
      {activeScans.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <CircularProgress size={18} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Active Scans</Typography>
            <Chip label={activeScans.length} size="small" color="warning" />
          </Stack>
          <Stack spacing={1}>
            {activeScans.map((scan) => (
              <Paper key={scan.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2">
                        {scan.repository ? `${scan.repository.owner}/${scan.repository.name}` : 'Unknown'}
                      </Typography>
                      <Chip label={scan.status} size="small" color={STATUS_COLOR[scan.status] ?? 'default'} />
                      <Chip label={scan.scanType.replace(/_/g, ' ')} size="small" variant="outlined" />
                    </Stack>
                    {scan.status === 'running' && <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />}
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        {/* Recent critical/high findings */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Critical & High Findings</Typography>
            {(stats?.recentFindings?.length ?? 0) > 0 && (
              <Chip label={stats?.recentFindings.length} size="small" color="error" />
            )}
          </Stack>
          {loading ? (
            <Skeleton variant="rounded" height={120} />
          ) : !stats?.recentFindings?.length ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <CheckCircleIcon sx={{ fontSize: 32, color: 'success.main', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">No critical or high findings</Typography>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {stats.recentFindings.map((f) => (
                <Stack
                  key={f.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ py: 0.75, px: 1, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => navigate(`/findings/${f.id}`)}
                >
                  <Chip
                    label={f.severity}
                    size="small"
                    sx={{ bgcolor: SEVERITY_COLORS[f.severity] ?? '#9e9e9e', color: '#fff', fontWeight: 600, minWidth: 56, fontSize: '0.7rem' }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{f.title}</Typography>
                    {f.repository ? (
                      <Typography variant="caption" color="text.secondary">{f.repository.owner}/{f.repository.name}</Typography>
                    ) : f.certificate ? (
                      <Typography variant="caption" color="text.secondary">{f.certificate.subjectCn}</Typography>
                    ) : null}
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        {/* Recent scans */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Recent Scans</Typography>
          {scansQuery.isLoading ? (
            <Skeleton variant="rounded" height={120} />
          ) : recentScans.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <HistoryIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">No scan history yet</Typography>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {recentScans.map((scan) => (
                <Stack
                  key={scan.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ py: 0.75, px: 1, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => navigate(`/scans/${scan.id}`)}
                >
                  <Chip label={scan.status} size="small" color={STATUS_COLOR[scan.status] ?? 'default'} sx={{ minWidth: 72 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                      {scan.repository ? `${scan.repository.owner}/${scan.repository.name}` : '--'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {scan.scanType.replace(/_/g, ' ')} &middot; {timeAgo(scan.startedAt ?? scan.createdAt)}
                    </Typography>
                  </Box>
                  {scan.status === 'completed' && (
                    <Chip label={`${scan.findingsTotal}`} size="small" variant="outlined" />
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        {/* Certificates */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Certificates</Typography>
            {(stats?.certificates?.length ?? 0) > 0 && (
              <Chip label={stats?.certificates.length} size="small" />
            )}
          </Stack>
          {loading ? (
            <Skeleton variant="rounded" height={120} />
          ) : !stats?.certificates?.length ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <HttpsIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">No certificates linked to this project</Typography>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {stats.certificates.map((cert) => {
                const days = Math.floor((new Date(cert.notAfter).getTime() - Date.now()) / 86400000);
                const expiryColor = days <= 0 ? '#dc2626' : days <= 30 ? '#dc2626' : days <= 90 ? '#f59e0b' : '#16a34a';
                return (
                  <Stack
                    key={cert.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ py: 0.75, px: 1, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                    onClick={() => navigate(`/assets/certificates/${cert.id}`)}
                  >
                    <HttpsIcon sx={{ fontSize: 16, color: expiryColor }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{cert.subjectCn}</Typography>
                      <Typography variant="caption" color="text.secondary">{cert.issuerCn}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: expiryColor, fontWeight: 600 }}>
                      {days <= 0 ? 'Expired' : `${days}d`}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Paper>
      </Box>
    </Box>
  );
}

// ===========================================================================
// Findings tab
// ===========================================================================

const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', suppressed: 'Suppressed', false_positive: 'False Positive' };

function FindingsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState('');

  const params: Record<string, string | number> = { page, per_page: 20, project_id: projectId, sort: 'severity', order: 'asc' };
  if (severity) params.severity = severity;

  const findings = useFindings(params);
  const data = findings.data?.data as Finding[] | undefined;
  const meta = findings.data?.meta;

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        {['', 'critical', 'high', 'medium', 'low'].map((s) => (
          <Chip
            key={s}
            label={s ? SEVERITY_LABEL[s] : 'All'}
            size="small"
            variant={severity === s ? 'filled' : 'outlined'}
            color={severity === s ? 'primary' : 'default'}
            onClick={() => { setSeverity(s); setPage(1); }}
            sx={{ cursor: 'pointer' }}
          />
        ))}
      </Stack>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Severity</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Repository</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>First Seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {findings.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 5 }).map((__, j) => <TableCell key={j}><Skeleton variant="text" /></TableCell>)}</TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>No findings</TableCell>
              </TableRow>
            ) : data.map((f) => (
              <TableRow key={f.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/findings/${f.id}`)}>
                <TableCell>
                  <Chip label={f.severity} size="small" sx={{ bgcolor: SEVERITY_COLORS[f.severity] ?? '#9e9e9e', color: '#fff', textTransform: 'uppercase' }} />
                </TableCell>
                <TableCell>{f.title.length > 60 ? f.title.slice(0, 57) + '...' : f.title}</TableCell>
                <TableCell>
                  {f.repository ? (
                    <Typography variant="body2" color="text.secondary">{f.repository.owner}/{f.repository.name}</Typography>
                  ) : '--'}
                </TableCell>
                <TableCell>
                  <Chip label={STATUS_LABEL[f.status] ?? f.status} size="small" variant="outlined"
                    sx={{ borderColor: STATUS_COLORS[f.status], color: STATUS_COLORS[f.status] }} />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>{new Date(f.firstSeenAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {meta && (meta.total ?? 0) > 20 && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">Page {meta.page} of {Math.ceil((meta.total ?? 0) / 20)}</Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="small" variant="outlined" disabled={page * 20 >= (meta.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

// ===========================================================================
// Edit project dialog
// ===========================================================================

function EditProjectDialog({ open, project, onClose }: {
  open: boolean; project: Project | undefined; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const updateMutation = useUpdateProject();

  const handleOpen = () => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? '');
    }
  };

  const handleSave = async () => {
    if (!project || !name.trim()) return;
    await updateMutation.mutateAsync({ id: project.id, name: name.trim(), description: description || undefined });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth TransitionProps={{ onEnter: handleOpen }}>
      <DialogTitle>Edit Project</DialogTitle>
      <DialogContent>
        <TextField
          label="Project Name" fullWidth required autoFocus
          value={name} onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }} size="small"
        />
        <TextField
          label="Description (optional)" fullWidth multiline rows={2}
          value={description} onChange={(e) => setDescription(e.target.value)}
          size="small"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!name.trim() || updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// Repo table with scan + remove actions
// ===========================================================================

function RepoTable({ repos, projectId }: { repos: Repository[]; projectId: string }) {
  const removeMutation = useRemoveRepoFromProject();
  const triggerScan = useTriggerScan();
  const [scanMsg, setScanMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [scanTarget, setScanTarget] = useState<Repository | null>(null);

  const handleScanConfirm = async (scanType: ScanTypeOption) => {
    if (!scanTarget) return;
    const repo = scanTarget;
    setScanTarget(null);
    setScanMsg(null);
    try {
      await triggerScan.mutateAsync({ repoId: repo.id, scanType });
      const label = scanType === 'full' ? 'Full scan' : scanType === 'code_secrets' ? 'Secret scan' : 'Dependency scan';
      setScanMsg({ type: 'success', text: `${label} queued for ${repo.owner}/${repo.name}` });
    } catch (err: unknown) {
      setScanMsg({ type: 'error', text: `${repo.owner}/${repo.name}: ${(err as { message?: string })?.message ?? 'Failed'}` });
    }
  };

  return (
    <Box>
      {scanMsg && <Alert severity={scanMsg.type} sx={{ mb: 2 }} onClose={() => setScanMsg(null)}>{scanMsg.text}</Alert>}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Repository</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Language</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell>Last Scan</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {repos.map((repo) => (
              <TableRow key={repo.id} hover>
                <TableCell sx={{ fontWeight: 500 }}>{repo.owner}/{repo.name}</TableCell>
                <TableCell><Chip label={repo.provider} size="small" variant="outlined" /></TableCell>
                <TableCell>{repo.language || '--'}</TableCell>
                <TableCell><Typography variant="body2" color="text.secondary">{repo.defaultBranch}</Typography></TableCell>
                <TableCell>
                  {repo.lastScanAt ? (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
                      <Typography variant="body2" color="text.secondary">{timeAgo(repo.lastScanAt)}</Typography>
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <ScheduleIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                      <Typography variant="body2" color="text.disabled">Never</Typography>
                    </Stack>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title="Trigger scan">
                      <IconButton size="small" color="primary" onClick={() => setScanTarget(repo)} disabled={triggerScan.isPending}>
                        {triggerScan.isPending ? <CircularProgress size={16} /> : <PlayArrowIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove from project">
                      <IconButton size="small" onClick={() => removeMutation.mutate({ repoId: repo.id, projectId })} disabled={removeMutation.isPending}
                        sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                        <LinkOffIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ScanTypeDialog repo={scanTarget} onConfirm={handleScanConfirm} onClose={() => setScanTarget(null)} />
    </Box>
  );
}

// ===========================================================================
// Scan type picker dialog
// ===========================================================================

const SCAN_OPTIONS: Array<{ value: ScanTypeOption; label: string; description: string; icon: React.ReactNode }> = [
  { value: 'full', label: 'Full Scan', description: 'Dependencies + SAST + Secrets', icon: <SecurityIcon /> },
  { value: 'code_dependencies', label: 'Dependency Scan', description: 'Find vulnerable packages', icon: <BugReportIcon /> },
  { value: 'code_secrets', label: 'Secret Scan', description: 'Detect hardcoded credentials', icon: <VpnKeyIcon /> },
];

function ScanTypeDialog({ repo, onConfirm, onClose }: {
  repo: Repository | null; onConfirm: (scanType: ScanTypeOption) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<ScanTypeOption>('full');
  return (
    <Dialog open={repo !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <PlayArrowIcon color="primary" />
          <Typography variant="h6">Scan {repo?.owner}/{repo?.name}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {SCAN_OPTIONS.map((opt) => (
            <Paper key={opt.value} variant="outlined" onClick={() => setSelected(opt.value)}
              sx={{ p: 2, cursor: 'pointer', borderColor: selected === opt.value ? 'primary.main' : 'divider', bgcolor: selected === opt.value ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' } }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ color: selected === opt.value ? 'primary.main' : 'text.secondary', mt: 0.25 }}>{opt.icon}</Box>
                <Box>
                  <Typography variant="subtitle2">{opt.label}</Typography>
                  <Typography variant="body2" color="text.secondary">{opt.description}</Typography>
                </Box>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => onConfirm(selected)}>Start Scan</Button>
      </DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// Scan history section
// ===========================================================================

function ScanHistory({ projectId, repoIds }: { projectId: string; repoIds: string[] }) {
  const scansQuery = useProjectScans(projectId, repoIds);
  const cancelScan = useCancelScan();
  const deleteScan = useDeleteScan();
  const clearHistory = useClearProjectScanHistory();
  const [confirmClear, setConfirmClear] = useState(false);
  const nav = useNavigate();

  const scans = ((scansQuery.data?.data ?? []) as Scan[]);
  const activeScans = scans.filter((s) => s.status === 'pending' || s.status === 'running');
  const historyScans = scans.filter((s) => s.status !== 'pending' && s.status !== 'running');

  return (
    <>
      {/* Active scans */}
      {activeScans.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <CircularProgress size={18} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Active Scans</Typography>
            <Chip label={activeScans.length} size="small" color="warning" />
          </Stack>
          <Stack spacing={1.5}>
            {activeScans.map((scan) => (
              <Paper key={scan.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle2">{scan.repository ? `${scan.repository.owner}/${scan.repository.name}` : 'Unknown'}</Typography>
                      <Chip label={scan.status} size="small" color={STATUS_COLOR[scan.status] ?? 'default'} />
                      <Chip label={scan.scanType.replace(/_/g, ' ')} size="small" variant="outlined" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">Started {timeAgo(scan.startedAt ?? scan.createdAt)}</Typography>
                    {scan.status === 'running' && <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />}
                  </Box>
                  <Tooltip title="Cancel scan">
                    <IconButton color="error" onClick={() => cancelScan.mutate(scan.id)} disabled={cancelScan.isPending}><StopIcon /></IconButton>
                  </Tooltip>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      {/* History */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Scan History</Typography>
        {historyScans.length > 0 && (
          <Button size="small" color="error" startIcon={<DeleteSweepIcon />} onClick={() => setConfirmClear(true)}>Clear</Button>
        )}
      </Stack>

      {scansQuery.isLoading ? (
        <Skeleton variant="rounded" height={120} />
      ) : historyScans.length === 0 ? (
        <Paper sx={{ py: 4, textAlign: 'center' }}>
          <HistoryIcon sx={{ fontSize: 36, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No scan history yet</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Repository</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell align="center">Findings</TableCell>
                <TableCell sx={{ width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {historyScans.map((scan) => (
                <TableRow key={scan.id} hover sx={{ cursor: 'pointer' }} onClick={() => nav(`/scans/${scan.id}`)}>
                  <TableCell sx={{ fontWeight: 500 }}>{scan.repository ? `${scan.repository.owner}/${scan.repository.name}` : '--'}</TableCell>
                  <TableCell><Typography variant="body2">{scan.scanType.replace(/_/g, ' ')}</Typography></TableCell>
                  <TableCell>
                    <Chip label={scan.status} size="small" color={STATUS_COLOR[scan.status] ?? 'default'}
                      icon={scan.status === 'completed' ? <CheckCircleIcon /> : scan.status === 'failed' ? <ErrorIcon /> : scan.status === 'cancelled' ? <CancelIcon /> : undefined} />
                  </TableCell>
                  <TableCell><Typography variant="body2" color="text.secondary">{timeAgo(scan.startedAt ?? scan.createdAt)}</Typography></TableCell>
                  <TableCell><Typography variant="body2" color="text.secondary">{formatDuration(scan.durationMs)}</Typography></TableCell>
                  <TableCell align="center">
                    {scan.status === 'completed' ? (
                      <Stack direction="row" spacing={1} justifyContent="center">
                        <Chip label={`${scan.findingsTotal} total`} size="small" variant="outlined" />
                        {scan.findingsNew > 0 && <Chip label={`+${scan.findingsNew}`} size="small" color="error" />}
                        {scan.findingsResolved > 0 && <Chip label={`-${scan.findingsResolved}`} size="small" color="success" />}
                      </Stack>
                    ) : '--'}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete scan">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this scan?')) deleteScan.mutate(scan.id); }}
                        disabled={deleteScan.isPending} sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Clear Scan History</DialogTitle>
        <DialogContent>
          <Typography>Delete all completed/failed/cancelled scans for this project?</Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>This will also delete associated findings.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={async () => { await clearHistory.mutateAsync(projectId); setConfirmClear(false); }}
            disabled={clearHistory.isPending} startIcon={clearHistory.isPending ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepIcon />}>
            {clearHistory.isPending ? 'Clearing...' : 'Clear All'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Domain monitoring section
// ===========================================================================

const ENDPOINT_STATUS_COLOR: Record<string, string> = { healthy: '#16a34a', unhealthy: '#dc2626', unreachable: '#dc2626' };

function DomainMonitoringSection({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const endpointsQuery = useMonitoredEndpoints({ projectId, per_page: 200 });
  const removeEndpoint = useRemoveEndpoint();
  const triggerCheck = useTriggerEndpointCheck();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const endpoints = (endpointsQuery.data?.data ?? []) as MonitoredEndpoint[];
  const hasPending = endpoints.some((e) => !e.lastStatus);

  useEffect(() => {
    if (!hasPending) return;
    const id = window.setInterval(() => endpointsQuery.refetch(), 5000);
    return () => window.clearInterval(id);
  }, [hasPending]);

  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add Domain</Button>
      </Stack>

      {endpoints.length === 0 ? (
        <Paper sx={{ py: 5, textAlign: 'center' }}>
          <LanguageIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary" sx={{ mb: 2 }}>No domains monitored in this project</Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add Domain</Button>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Host</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Tags</TableCell>
                <TableCell>Interval</TableCell>
                <TableCell>Last Check</TableCell>
                <TableCell>Response</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {endpoints.map((ep) => (
                <TableRow key={ep.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/monitoring/domains/${ep.id}`)}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{ep.host}{ep.port !== 443 ? `:${ep.port}` : ''}</Typography>
                    {ep.label && <Typography variant="caption" color="text.secondary">{ep.label}</Typography>}
                  </TableCell>
                  <TableCell>
                    {ep.lastStatus ? (
                      <Chip label={ep.lastStatus} size="small" sx={{ bgcolor: ENDPOINT_STATUS_COLOR[ep.lastStatus] ?? '#9e9e9e', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }} />
                    ) : (
                      <Chip label="pending" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {Object.entries(ep.tags ?? {}).map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell><Typography variant="caption">{ep.checkInterval}</Typography></TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{timeAgo(ep.lastCheckedAt)}</Typography></TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{ep.lastResponseMs != null ? `${ep.lastResponseMs}ms` : '--'}</Typography></TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="Edit tags"><IconButton size="small" onClick={() => setEditId(ep.id)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Check now"><IconButton size="small" onClick={() => triggerCheck.mutate(ep.id)}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Remove">
                        <IconButton size="small" onClick={() => { if (confirm(`Remove ${ep.host}?`)) removeEndpoint.mutate(ep.id); }}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <AddDomainDialog open={addOpen} projectId={projectId} onClose={() => setAddOpen(false)} />
      {editId && <EditTagsDialog endpoint={endpoints.find((e) => e.id === editId)!} onClose={() => setEditId(null)} />}
    </>
  );
}

// ===========================================================================
// Add repo dialog
// ===========================================================================

function AddRepoDialog({ open, projectId, existingRepoIds, onClose }: {
  open: boolean; projectId: string; existingRepoIds: Set<string>; onClose: () => void;
}) {
  const allRepos = useRepositories();
  const assignMutation = useAssignRepoToProject();
  const [search, setSearch] = useState('');

  const repos = ((allRepos.data?.data ?? []) as Repository[])
    .filter((r) => !existingRepoIds.has(r.id))
    .filter((r) => !search || `${r.owner}/${r.name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Repository to Project</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select a repository. A first scan will be triggered automatically for repos not yet scanned.
        </Typography>
        <TextField size="small" fullWidth placeholder="Search repositories..." value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 2 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        {allRepos.isLoading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}><Skeleton variant="text" width="60%" sx={{ mx: 'auto' }} /></Box>
        ) : repos.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">{search ? 'No matching repositories' : 'All repositories are already in this project'}</Typography>
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Repository</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Language</TableCell>
                  <TableCell sx={{ width: 80 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {repos.map((repo) => (
                  <TableRow key={repo.id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{repo.owner}/{repo.name}</TableCell>
                    <TableCell><Chip label={repo.provider} size="small" variant="outlined" /></TableCell>
                    <TableCell>{repo.language || '--'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" startIcon={<AddIcon />}
                        onClick={() => assignMutation.mutateAsync({ repoId: repo.id, projectId })} disabled={assignMutation.isPending}>Add</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// Add domain dialog
// ===========================================================================

function AddDomainDialog({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
  const addMutation = useAddEndpoints();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [interval, setInterval] = useState<string>('1m');
  const [tagEntries, setTagEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

  const handleAddTag = () => {
    const k = newTagKey.trim();
    if (!k || tagEntries.some((t) => t.key === k)) return;
    setTagEntries([...tagEntries, { key: k, value: newTagValue.trim() }]);
    setNewTagKey(''); setNewTagValue('');
  };

  const handleSubmit = async () => {
    if (!host.trim()) return;
    const tags: Record<string, string> = {};
    for (const t of tagEntries) { tags[t.key] = t.value; }
    await addMutation.mutateAsync({ endpoints: [{ host: host.trim(), port: parseInt(port, 10) || 443, tags }], checkInterval: interval, projectId });
    setHost(''); setPort('443'); setTagEntries([]);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Domain to Monitor</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={2}>
            <TextField label="Host" placeholder="example.com" value={host} onChange={(e) => setHost(e.target.value)} fullWidth size="small" />
            <TextField label="Port" value={port} onChange={(e) => setPort(e.target.value)} sx={{ width: 100 }} size="small" />
          </Stack>
          <TextField label="Check Interval" select value={interval} onChange={(e) => setInterval(e.target.value)} size="small" SelectProps={{ native: true }}>
            <option value="30s">Every 30s</option><option value="1m">Every 1m</option><option value="5m">Every 5m</option>
            <option value="15m">Every 15m</option><option value="1h">Every 1h</option><option value="24h">Every 24h</option>
          </TextField>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Tags</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {tagEntries.map((t) => <Chip key={t.key} label={`${t.key}: ${t.value}`} size="small" onDelete={() => setTagEntries(tagEntries.filter((x) => x.key !== t.key))} />)}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="flex-end">
              <TextField label="Key" placeholder="env" value={newTagKey} onChange={(e) => setNewTagKey(e.target.value)} size="small" sx={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }} />
              <TextField label="Value" placeholder="prod" value={newTagValue} onChange={(e) => setNewTagValue(e.target.value)} size="small" sx={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }} />
              <Button variant="outlined" size="small" onClick={handleAddTag} disabled={!newTagKey.trim()}>Add</Button>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!host.trim() || addMutation.isPending}>
          {addMutation.isPending ? 'Adding...' : 'Add Domain'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// Edit tags dialog
// ===========================================================================

function EditTagsDialog({ endpoint, onClose }: { endpoint: MonitoredEndpoint; onClose: () => void }) {
  const updateMutation = useUpdateEndpoint();
  const [tagEntries, setTagEntries] = useState<Array<{ key: string; value: string }>>(
    Object.entries(endpoint.tags ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

  const handleAddTag = () => {
    const k = newTagKey.trim();
    if (!k || tagEntries.some((t) => t.key === k)) return;
    setTagEntries([...tagEntries, { key: k, value: newTagValue.trim() }]);
    setNewTagKey(''); setNewTagValue('');
  };

  const handleSave = async () => {
    const tags: Record<string, string> = {};
    for (const t of tagEntries) { tags[t.key] = t.value; }
    await updateMutation.mutateAsync({ id: endpoint.id, tags });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Tags — {endpoint.host}{endpoint.port !== 443 ? `:${endpoint.port}` : ''}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {tagEntries.map((t) => <Chip key={t.key} label={`${t.key}: ${t.value}`} size="small" onDelete={() => setTagEntries(tagEntries.filter((x) => x.key !== t.key))} />)}
            {tagEntries.length === 0 && <Typography variant="body2" color="text.secondary">No tags yet</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <TextField label="Key" placeholder="env" value={newTagKey} onChange={(e) => setNewTagKey(e.target.value)} size="small" sx={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }} />
            <TextField label="Value" placeholder="prod" value={newTagValue} onChange={(e) => setNewTagValue(e.target.value)} size="small" sx={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }} />
            <Button variant="outlined" size="small" onClick={handleAddTag} disabled={!newTagKey.trim()}>Add</Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ===========================================================================
// Servers Section
// ===========================================================================

const STATUS_DOT: Record<string, string> = { active: '#16a34a', inactive: '#dc2626', decommissioned: '#6b7280' };

function ServersSection({ projectId, servers }: { projectId: string; servers: Server[] }) {
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const decommissionMutation = useDecommissionServer();

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setShowAdd(true)}>
          Add Server
        </Button>
      </Stack>

      {servers.length === 0 ? (
        <Paper sx={{ py: 5, textAlign: 'center' }}>
          <DnsIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary" sx={{ mb: 2 }}>No servers in this project yet</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowAdd(true)}>Add Server</Button>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Hostname</TableCell>
                <TableCell>OS</TableCell>
                <TableCell>Agent</TableCell>
                <TableCell>Last Heartbeat</TableCell>
                <TableCell sx={{ width: 90 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map((s) => (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/assets/servers/${s.id}`)}>
                  <TableCell>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: STATUS_DOT[s.status] ?? '#6b7280' }} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{s.hostname}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{s.osFamily} {s.osVersion}</TableCell>
                  <TableCell>
                    <Chip label={s.agentVersion ?? '—'} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{timeAgo(s.lastHeartbeat)}</TableCell>
                  <TableCell>
                    <Tooltip title="Delete server (agent will stop)">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
                        disabled={decommissionMutation.isPending}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <AddServerDialog open={showAdd} onClose={() => setShowAdd(false)} projectId={projectId} />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Server</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>This action cannot be undone.</Alert>
          <Typography variant="body2">
            Are you sure you want to delete <strong>{deleteTarget?.hostname}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            The agent on this server will stop sending data and disable itself on the next heartbeat (within 60 seconds).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={decommissionMutation.isPending}
            onClick={() => {
              if (deleteTarget) {
                decommissionMutation.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                });
              }
            }}
          >
            {decommissionMutation.isPending ? 'Deleting...' : 'Delete Server'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

