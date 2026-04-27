import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  CircularProgress,
  TablePagination,
} from '@mui/material';
import { useFindings, type FindingsFilters } from '../../api/hooks';
import { WorkStateChip } from '../../components/status';
import { workStateFromFindingStatus, type WorkState } from '../../lib/status';
import { StatCard } from '../../components/design';
import { useProjectScope } from '../../lib/useProjectScope';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#22d3ee',
  low: '#94a3b8',
  info: '#94a3b8',
};

const SOURCES = ['all', 'code_scanner', 'infra_agent', 'cert_monitor', 'cve_scan', 'security_audit', 'brute_force'];

/** Work-state tab → backend `status` query param. */
const WORK_STATE_TO_QUERY: Record<WorkState | 'all', string | undefined> = {
  all: undefined,
  new: 'open',
  'in-progress': 'in_progress',
  resolved: 'resolved',
  dismissed: 'ignored',
};

const WORK_STATE_TABS: Array<{ key: WorkState | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: '○ new' },
  { key: 'in-progress', label: '◔ in-progress' },
  { key: 'resolved', label: '● resolved' },
  { key: 'dismissed', label: '✕ dismissed' },
];

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function FindingsPage() {
  const { projectId: scopedProjectId } = useProjectScope();
  const [severity, setSeverity] = useState<string>('all');
  const [source, setSource] = useState('all');
  const [workState, setWorkState] = useState<WorkState | 'all'>('new');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const navigate = useNavigate();

  const filters: FindingsFilters = {
    ...(severity !== 'all' && { severity }),
    ...(WORK_STATE_TO_QUERY[workState] && { status: WORK_STATE_TO_QUERY[workState] }),
    ...(source !== 'all' && { source }),
    ...(scopedProjectId && { projectId: scopedProjectId }),
    page: page + 1,
    limit: rowsPerPage,
  };

  const { data: findings, isLoading } = useFindings(filters);

  // Parallel query for severity distribution within the current work-state filter,
  // not limited by severity — used for the stat cards.
  const { data: severityCountsSource } = useFindings({
    ...(WORK_STATE_TO_QUERY[workState] && { status: WORK_STATE_TO_QUERY[workState] }),
    ...(source !== 'all' && { source }),
    ...(scopedProjectId && { projectId: scopedProjectId }),
    page: 1,
    limit: 500,
  });

  const counts = {
    critical: severityCountsSource?.filter((f) => f.severity === 'critical').length ?? 0,
    high:     severityCountsSource?.filter((f) => f.severity === 'high').length ?? 0,
    medium:   severityCountsSource?.filter((f) => f.severity === 'medium').length ?? 0,
    low:      severityCountsSource?.filter((f) => f.severity === 'low').length ?? 0,
    info:     severityCountsSource?.filter((f) => f.severity === 'info').length ?? 0,
  };

  const toggleSeverity = (sev: string) => {
    setSeverity((prev) => (prev === sev ? 'all' : sev));
    setPage(0);
  };

  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Findings
      </Typography>

      {/* Severity stat cards — click to filter, click again to clear */}
      <Grid container spacing={2} mb={3}>
        {([
          { label: 'Critical', value: counts.critical, color: 'error', key: 'critical' },
          { label: 'High',     value: counts.high,     color: 'warning', key: 'high' },
          { label: 'Medium',   value: counts.medium,   color: 'info', key: 'medium' },
          { label: 'Low',      value: counts.low,      color: 'muted', key: 'low' },
        ] as const).map((s) => (
          <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
            <StatCard
              value={s.value}
              label={severity === s.key ? `${s.label} · filtering` : s.label}
              color={s.color}
              active={severity === s.key}
              onClick={() => toggleSeverity(s.key)}
            />
          </Grid>
        ))}
      </Grid>

      {/* Work-state filter chips + source dropdown */}
      <Stack direction="row" spacing={1} alignItems="center" mb={3} flexWrap="wrap" useFlexGap>
        {WORK_STATE_TABS.map((t) => {
          const isActive = workState === t.key;
          return (
            <Chip
              key={t.key}
              label={t.label}
              size="small"
              color={isActive ? 'primary' : 'default'}
              variant={isActive ? 'filled' : 'outlined'}
              onClick={() => { setWorkState(t.key); setPage(0); }}
              sx={{ textTransform: 'lowercase', fontWeight: 500 }}
            />
          );
        })}
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Source</InputLabel>
          <Select value={source} label="Source" onChange={(e) => { setSource(e.target.value); setPage(0); }}>
            {SOURCES.map((s) => (
              <MenuItem key={s} value={s}>{formatLabel(s)}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {/* Table */}
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Severity</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Work state</TableCell>
                <TableCell>CVE</TableCell>
                <TableCell align="right">CVSS</TableCell>
                <TableCell>Asset</TableCell>
                <TableCell>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : !findings?.length ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                    No findings match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                findings.map((f) => (
                  <TableRow key={f.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/findings/${f.id}`)}>
                    <TableCell>
                      <Chip
                        label={f.severity}
                        size="small"
                        sx={{
                          bgcolor: `${SEVERITY_COLORS[f.severity] ?? '#94a3b8'}26`,
                          color: SEVERITY_COLORS[f.severity] ?? '#94a3b8',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 300 }} noWrap>
                        {f.title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatLabel(f.source)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <WorkStateChip state={workStateFromFindingStatus(f.status)} />
                    </TableCell>
                    <TableCell>
                      {f.cveId ? (
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {f.cveId}
                        </Typography>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {f.cvssScore != null ? (
                        <Typography variant="body2" fontWeight={500}>
                          {f.cvssScore.toFixed(1)}
                        </Typography>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {f.repository
                          ? `${f.repository.owner}/${f.repository.name}`
                          : f.server
                            ? f.server.hostname
                            : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                        {new Date(f.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={-1}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
          labelDisplayedRows={({ from, to }) => `${from}-${to}`}
        />
      </Card>
    </Box>
  );
}
