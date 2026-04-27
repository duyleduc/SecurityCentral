import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
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
  TextField,
  IconButton,
  InputAdornment,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useFindings, type FindingsFilters } from '../../api/hooks';
import { WorkStateChip } from '../../components/status';
import { workStateFromFindingStatus, type WorkState } from '../../lib/status';
import { StatusPill } from '../../components/design';
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
  const [search, setSearch] = useState('');
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

  const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;
  const hasFilters = severity !== 'all' || source !== 'all' || workState !== 'new' || !!search;
  const clearAll = () => {
    setSeverity('all');
    setSource('all');
    setWorkState('new');
    setSearch('');
    setPage(0);
  };

  // Apply search client-side over title + cve + asset.
  const visibleFindings = (findings ?? []).filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const asset = f.repository ? `${f.repository.owner}/${f.repository.name}` : f.server?.hostname ?? '';
    return (
      f.title.toLowerCase().includes(q)
      || (f.cveId ?? '').toLowerCase().includes(q)
      || asset.toLowerCase().includes(q)
    );
  });

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4">Findings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Vulnerabilities and misconfigurations across all assets ·{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
              {total} {total === 1 ? 'finding' : 'findings'}
            </Box>
          </Typography>
        </Box>
      </Stack>

      {/* Severity pills + search */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.25, px: 1.75, '&:last-child': { pb: 1.25 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <StatusPill label="All" count={total} active={severity === 'all'} onClick={() => { setSeverity('all'); setPage(0); }} />
              <StatusPill label="Critical" color="#ef4444" count={counts.critical} active={severity === 'critical'} onClick={() => toggleSeverity('critical')} />
              <StatusPill label="High" color="#f59e0b" count={counts.high} active={severity === 'high'} onClick={() => toggleSeverity('high')} />
              <StatusPill label="Medium" color="#22d3ee" count={counts.medium} active={severity === 'medium'} onClick={() => toggleSeverity('medium')} />
              <StatusPill label="Low" color="#94a3b8" count={counts.low} active={severity === 'low'} onClick={() => toggleSeverity('low')} />
            </Stack>

            <Box sx={{ flex: 1 }} />

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small" placeholder="Search title, CVE, or asset" value={search}
                onChange={(e) => setSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <IconButton size="small" onClick={() => setSearch('')}>
                        <ClearIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    ) : null,
                  },
                }}
                sx={{ width: 280 }}
              />
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Source</InputLabel>
                <Select value={source} label="Source" onChange={(e) => { setSource(e.target.value); setPage(0); }}>
                  {SOURCES.map((s) => (
                    <MenuItem key={s} value={s}>{formatLabel(s)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {hasFilters && (
                <Button size="small" onClick={clearAll} sx={{ textTransform: 'none', color: 'text.secondary' }}>
                  Clear
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Work-state pills — secondary toggle row */}
      <Stack direction="row" spacing={1} alignItems="center" mb={2} flexWrap="wrap" useFlexGap>
        <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.6, mr: 0.5 }}>
          Work state
        </Typography>
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
              ) : !visibleFindings.length ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                    {hasFilters ? 'No findings match the current filters.' : 'No findings.'}
                    {hasFilters && (
                      <>{' '}<Button size="small" onClick={clearAll} sx={{ textTransform: 'none' }}>Clear filters</Button></>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                visibleFindings.map((f) => (
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
