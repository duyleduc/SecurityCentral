import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, Stack, Paper, Skeleton,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Alert,
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
import {
  useProject, useRepositories, useAssignRepoToProject, useRemoveRepoFromProject,
  useDeleteProject, useTriggerScan, useProjectScans, useCancelScan, useDeleteScan,
  useClearProjectScanHistory,
  type Repository, type Project, type Scan, type ScanTypeOption,
} from '../../api/hooks.js';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  completed: 'success',
  failed: 'error',
  running: 'warning',
  pending: 'info',
  cancelled: 'default',
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
  const deleteMutation = useDeleteProject();
  const navigate = useNavigate();
  const [addRepoOpen, setAddRepoOpen] = useState(false);

  const data = project.data?.data as (Project & { repositories: Repository[] }) | undefined;
  const repos = data?.repositories ?? [];
  const repoIds = repos.map((r) => r.id);

  const handleDelete = () => {
    if (confirm(`Delete "${data?.name}"? Assets won't be deleted.`)) {
      deleteMutation.mutate(projectId, { onSuccess: () => navigate('/projects') });
    }
  };

  if (project.isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} sx={{ mb: 2 }} />
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
        <Tooltip title="Delete project">
          <IconButton color="error" onClick={handleDelete}>
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Repositories section */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CodeIcon color="action" />
          <Typography variant="h6">Repositories</Typography>
          <Chip label={repos.length} size="small" />
        </Stack>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddRepoOpen(true)}>
          Add Repository
        </Button>
      </Stack>

      {repos.length === 0 ? (
        <Paper sx={{ py: 5, textAlign: 'center' }}>
          <CodeIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary" sx={{ mb: 1 }}>No repositories in this project yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add a repository to start scanning for vulnerabilities
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddRepoOpen(true)}>
            Add Repository
          </Button>
        </Paper>
      ) : (
        <RepoTable repos={repos} projectId={projectId} />
      )}

      {/* Scan history section */}
      {repos.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <ScanHistory projectId={projectId} repoIds={repoIds} />
        </Box>
      )}

      <AddRepoDialog
        open={addRepoOpen}
        projectId={projectId}
        existingRepoIds={new Set(repoIds)}
        onClose={() => setAddRepoOpen(false)}
      />
    </Box>
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
      const msg = (err as { message?: string })?.message ?? 'Failed to trigger scan';
      setScanMsg({ type: 'error', text: `${repo.owner}/${repo.name}: ${msg}` });
    }
  };

  return (
    <Box>
      {scanMsg && (
        <Alert severity={scanMsg.type} sx={{ mb: 2 }} onClose={() => setScanMsg(null)}>{scanMsg.text}</Alert>
      )}
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
                      <IconButton
                        size="small"
                        onClick={() => removeMutation.mutate({ repoId: repo.id, projectId })}
                        disabled={removeMutation.isPending}
                        sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                      >
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

      {/* Scan type picker */}
      <ScanTypeDialog
        repo={scanTarget}
        onConfirm={handleScanConfirm}
        onClose={() => setScanTarget(null)}
      />
    </Box>
  );
}

// ===========================================================================
// Scan type picker dialog
// ===========================================================================

const SCAN_OPTIONS: Array<{ value: ScanTypeOption; label: string; description: string; icon: React.ReactNode }> = [
  { value: 'full', label: 'Full Scan', description: 'Dependencies + SAST + Secrets — complete security analysis', icon: <SecurityIcon /> },
  { value: 'code_dependencies', label: 'Dependency Scan', description: 'npm audit, pip-audit, composer audit, bundle-audit — find vulnerable packages', icon: <BugReportIcon /> },
  { value: 'code_secrets', label: 'Secret Scan', description: 'Detect hardcoded API keys, tokens, passwords, and private keys', icon: <VpnKeyIcon /> },
];

function ScanTypeDialog({ repo, onConfirm, onClose }: {
  repo: Repository | null;
  onConfirm: (scanType: ScanTypeOption) => void;
  onClose: () => void;
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
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {repo?.language ? `Detected language: ${repo.language}. ` : ''}Choose what to scan:
        </Typography>

        <Stack spacing={1}>
          {SCAN_OPTIONS.map((opt) => (
            <Paper
              key={opt.value}
              variant="outlined"
              onClick={() => setSelected(opt.value)}
              sx={{
                p: 2, cursor: 'pointer',
                borderColor: selected === opt.value ? 'primary.main' : 'divider',
                bgcolor: selected === opt.value ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ color: selected === opt.value ? 'primary.main' : 'text.secondary', mt: 0.25 }}>
                  {opt.icon}
                </Box>
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
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => onConfirm(selected)}>
          Start Scan
        </Button>
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

  const scans = ((scansQuery.data?.data ?? []) as Scan[]);
  const activeScans = scans.filter((s) => s.status === 'pending' || s.status === 'running');
  const historyScans = scans.filter((s) => s.status !== 'pending' && s.status !== 'running');

  const handleClearHistory = async () => {
    await clearHistory.mutateAsync(projectId);
    setConfirmClear(false);
  };

  return (
    <>
      {/* Active scans */}
      {activeScans.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <CircularProgress size={18} />
            <Typography variant="h6">Active Scans</Typography>
            <Chip label={activeScans.length} size="small" color="warning" />
          </Stack>

          <Stack spacing={1.5}>
            {activeScans.map((scan) => (
              <Paper key={scan.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle2">
                        {scan.repository ? `${scan.repository.owner}/${scan.repository.name}` : 'Unknown'}
                      </Typography>
                      <Chip label={scan.status} size="small" color={STATUS_COLOR[scan.status] ?? 'default'} />
                      <Chip label={scan.scanType.replace(/_/g, ' ')} size="small" variant="outlined" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Started {timeAgo(scan.startedAt ?? scan.createdAt)}
                    </Typography>
                    {scan.status === 'running' && (
                      <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />
                    )}
                  </Box>
                  <Tooltip title="Cancel scan">
                    <IconButton
                      color="error"
                      onClick={() => cancelScan.mutate(scan.id)}
                      disabled={cancelScan.isPending}
                    >
                      <StopIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      {/* Scan history */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <HistoryIcon color="action" />
          <Typography variant="h6">Scan History</Typography>
          {historyScans.length > 0 && <Chip label={historyScans.length} size="small" />}
        </Stack>
        {historyScans.length > 0 && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteSweepIcon />}
            onClick={() => setConfirmClear(true)}
          >
            Clear History
          </Button>
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
                <TableCell>Ecosystems</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell align="center">Findings</TableCell>
                <TableCell sx={{ width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {historyScans.map((scan) => (
                <TableRow key={scan.id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {scan.repository ? `${scan.repository.owner}/${scan.repository.name}` : '--'}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{scan.scanType.replace(/_/g, ' ')}</Typography>
                  </TableCell>
                  <TableCell>
                    {scan.metadata?.ecosystems?.length ? (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {scan.metadata.ecosystems.map((eco) => (
                          <Chip key={eco.name} label={eco.language} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">--</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={scan.status}
                      size="small"
                      color={STATUS_COLOR[scan.status] ?? 'default'}
                      icon={scan.status === 'completed' ? <CheckCircleIcon /> : scan.status === 'failed' ? <ErrorIcon /> : scan.status === 'cancelled' ? <CancelIcon /> : undefined}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{timeAgo(scan.startedAt ?? scan.createdAt)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{formatDuration(scan.durationMs)}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    {scan.status === 'completed' ? (
                      <Stack direction="row" spacing={1} justifyContent="center">
                        <Chip label={`${scan.findingsTotal} total`} size="small" variant="outlined" />
                        {scan.findingsNew > 0 && <Chip label={`+${scan.findingsNew}`} size="small" color="error" />}
                        {scan.findingsResolved > 0 && <Chip label={`-${scan.findingsResolved}`} size="small" color="success" />}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">--</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete scan">
                      <IconButton
                        size="small"
                        onClick={() => deleteScan.mutate(scan.id)}
                        disabled={deleteScan.isPending}
                        sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
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

      {/* Clear history confirmation */}
      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Clear Scan History</DialogTitle>
        <DialogContent>
          <Typography>
            Delete all completed, failed, and cancelled scans for this project?
            Active scans will not be affected.
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            This will also delete findings associated with these scans. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleClearHistory}
            disabled={clearHistory.isPending}
            startIcon={clearHistory.isPending ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepIcon />}
          >
            {clearHistory.isPending ? 'Clearing...' : 'Clear All'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Add repo dialog
// ===========================================================================

function AddRepoDialog({ open, projectId, existingRepoIds, onClose }: {
  open: boolean;
  projectId: string;
  existingRepoIds: Set<string>;
  onClose: () => void;
}) {
  const allRepos = useRepositories();
  const assignMutation = useAssignRepoToProject();
  const [search, setSearch] = useState('');

  const repos = ((allRepos.data?.data ?? []) as Repository[])
    .filter((r) => !existingRepoIds.has(r.id))
    .filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return `${r.owner}/${r.name}`.toLowerCase().includes(q);
    });

  const handleAssign = async (repoId: string) => {
    await assignMutation.mutateAsync({ repoId, projectId });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Repository to Project</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select a repository to add. A first scan will be triggered automatically for repos that haven't been scanned yet.
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
        />

        {allRepos.isLoading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Skeleton variant="text" width="60%" sx={{ mx: 'auto' }} />
            <Skeleton variant="text" width="40%" sx={{ mx: 'auto' }} />
          </Box>
        ) : repos.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {search ? 'No matching repositories found' : 'All synced repositories are already in this project'}
            </Typography>
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
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={() => handleAssign(repo.id)}
                        disabled={assignMutation.isPending}
                      >
                        Add
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
