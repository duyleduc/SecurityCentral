import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Chip, Button, Card, CardContent, Stack, Tabs, Tab,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Alert, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import BugReportIcon from '@mui/icons-material/BugReport';
import HistoryIcon from '@mui/icons-material/History';
import {
  useRepository,
  useRepositoryScans,
  useTriggerScan,
  type Scan,
} from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};

function statusColor(status: string): 'success' | 'warning' | 'error' | 'default' | 'info' {
  switch (status) {
    case 'completed': return 'success';
    case 'running': return 'info';
    case 'failed': return 'error';
    default: return 'default';
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: repo, isLoading: repoLoading } = useRepository(id ?? '');
  const { data: scans, isLoading: scansLoading } = useRepositoryScans(id ?? '');
  const triggerScan = useTriggerScan();
  const [tab, setTab] = useState(0);

  if (repoLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!repo) {
    return <Box sx={{ py: 5, textAlign: 'center' }}><Typography color="text.secondary">Repository not found</Typography></Box>;
  }

  const handleTriggerScan = () => {
    if (!id) return;
    triggerScan.mutate({ repoId: id, scanType: 'full' });
  };

  const openFindings = repo._count?.findings ?? 0;
  const fc = (repo as any).findingCounts as Record<string, number> | undefined;
  const { score, breakdown } = computeScore(fc ?? {});

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => navigate('/repositories')} sx={{ mb: 2 }}>
        Back to Repositories
      </Button>

      {/* Header card */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box display="flex" alignItems="center" gap={2}>
              <ScoreBadge score={score} breakdown={breakdown} size="medium" />
              <Box>
                <Typography variant="h5" sx={{ mb: 1 }}>{repo.owner}/{repo.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                  <Chip label={repo.provider} size="small" variant="outlined" />
                  <Chip label={`branch: ${repo.defaultBranch}`} size="small" variant="outlined" />
                  {repo.language && <Chip label={repo.language} size="small" variant="outlined" />}
                </Stack>
              </Box>
            </Box>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={handleTriggerScan}
              disabled={triggerScan.isPending}
            >
              {triggerScan.isPending ? 'Scanning...' : 'Trigger Scan'}
            </Button>
          </Stack>

          {triggerScan.isError && <Alert severity="error" sx={{ mt: 1 }}>{(triggerScan.error as Error).message}</Alert>}
          {triggerScan.isSuccess && <Alert severity="success" sx={{ mt: 1 }}>Scan triggered successfully</Alert>}

          {/* Severity summary */}
          <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
            {['critical', 'high', 'medium', 'low'].map((sev) => (
              <Box key={sev} sx={{ textAlign: 'center', minWidth: 70 }}>
                <Typography variant="h5" sx={{ color: SEVERITY_COLORS[sev], fontWeight: 700 }}>
                  {fc?.[sev] ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{sev}</Typography>
              </Box>
            ))}
            <Divider orientation="vertical" flexItem />
            <Box sx={{ textAlign: 'center', minWidth: 70 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{openFindings}</Typography>
              <Typography variant="caption" color="text.secondary">Open</Typography>
            </Box>
          </Stack>

          {/* Last scan info */}
          {repo.lastScanAt && (
            <Box sx={{ mt: 2, bgcolor: 'background.default', borderRadius: 1, p: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                Last scanned: {new Date(repo.lastScanAt).toLocaleString()}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tab icon={<HistoryIcon />} iconPosition="start" label={`Scan History (${scans?.length ?? 0})`} />
        </Tabs>

        {/* Scan History Tab */}
        {tab === 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell align="right">Findings</TableCell>
                  <TableCell align="right">Duration</TableCell>
                  <TableCell>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {scansLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>
                  ))
                ) : !scans?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      No scans yet. Click "Trigger Scan" to start.
                    </TableCell>
                  </TableRow>
                ) : scans.map((s: Scan) => (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Chip label={s.status} size="small" color={statusColor(s.status)} />
                    </TableCell>
                    <TableCell>{s.type}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{s.trigger}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{s.branch ?? '-'}</TableCell>
                    <TableCell align="right">
                      {s.findingsTotal > 0 ? (
                        <Typography variant="body2" fontWeight={500}>{s.findingsTotal}</Typography>
                      ) : '0'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                      {formatDuration(s.duration)}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                      {new Date(s.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}
