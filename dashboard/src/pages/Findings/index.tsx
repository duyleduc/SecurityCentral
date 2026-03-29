import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Box, Typography, TextField, Select, MenuItem, Button, Chip,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Stack, InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ClearIcon from '@mui/icons-material/Clear';
import { useFindings, useProjects, type Finding, type Project } from '../../api/hooks.js';
import { FindingDetail } from '../FindingDetail/index.js';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../theme/theme.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'suppressed', 'false_positive'] as const;

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  suppressed: 'Suppressed',
  false_positive: 'False Positive',
};

export function FindingsPage() {
  const { id } = useParams<{ id?: string }>();

  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('severity');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  const projectsQuery = useProjects();
  const projects = (projectsQuery.data?.data ?? []) as Project[];

  const params: Record<string, string | number> = { page, per_page: perPage, sort, order };
  if (severity) params.severity = severity;
  if (status) params.status = status;
  if (projectId) params.project_id = projectId;
  if (q) params.q = q;

  const findings = useFindings(params);
  const data = findings.data?.data as Finding[] | undefined;
  const meta = findings.data?.meta;

  const toggleSort = useCallback((col: string) => {
    if (sort === col) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setOrder('desc'); }
  }, [sort]);

  if (id) return <FindingDetail findingId={id} />;

  const totalPages = Math.ceil((meta?.total ?? 0) / (meta?.per_page ?? 25));

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Findings</Typography>

      {/* Filter Bar */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search CVE or title..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          sx={{ width: 260 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
            ),
          }}
        />
        <Select
          size="small"
          value={severity}
          onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
          displayEmpty
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All Severities</MenuItem>
          {SEVERITIES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
        </Select>
        <Select
          size="small"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          displayEmpty
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All Statuses</MenuItem>
          {STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_LABEL[s]}</MenuItem>)}
        </Select>
        <Select
          size="small"
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); setPage(1); }}
          displayEmpty
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All Projects</MenuItem>
          {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </Select>
        {(severity || status || projectId || q) && (
          <Button
            size="small"
            startIcon={<ClearIcon />}
            onClick={() => { setSeverity(''); setStatus(''); setProjectId(''); setQ(''); setPage(1); }}
          >
            Clear filters
          </Button>
        )}
      </Stack>

      {/* Table */}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <SortableCell label="Severity" col="severity" cur={sort} ord={order} onSort={toggleSort} />
              <TableCell>Title</TableCell>
              <TableCell>Repository</TableCell>
              <TableCell>CVE</TableCell>
              <TableCell>Status</TableCell>
              <SortableCell label="First Seen" col="first_seen_at" cur={sort} ord={order} onSort={toggleSort} />
              <SortableCell label="CVSS" col="cvss_score" cur={sort} ord={order} onSort={toggleSort} align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {findings.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                  No findings match your filters
                </TableCell>
              </TableRow>
            ) : data.map((f) => (
              <TableRow key={f.id} hover>
                <TableCell>
                  <Chip
                    label={f.severity}
                    size="small"
                    sx={{
                      bgcolor: SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.info,
                      color: '#fff',
                      textTransform: 'uppercase',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Box
                    component={Link}
                    to={`/findings/${f.id}`}
                    sx={{ color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                  >
                    {f.title.length > 55 ? f.title.slice(0, 52) + '...' : f.title}
                  </Box>
                </TableCell>
                <TableCell>
                  {f.repository ? (
                    <Stack direction="column" spacing={0.3}>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                        {f.repository.owner}/{f.repository.name}
                      </Typography>
                      {f.repository.project && (
                        <Box
                          component={Link}
                          to={`/projects/${f.repository.project.id}`}
                          sx={{ color: 'primary.main', textDecoration: 'none', fontSize: '0.7rem', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {f.repository.project.name}
                        </Box>
                      )}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">--</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{f.cveId ?? '-'}</TableCell>
                <TableCell>
                  <Chip
                    label={STATUS_LABEL[f.status] ?? f.status}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderColor: STATUS_COLORS[f.status] ?? STATUS_COLORS.open,
                      color: STATUS_COLORS[f.status] ?? STATUS_COLORS.open,
                    }}
                  />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                  {new Date(f.firstSeenAt).toLocaleDateString()}
                </TableCell>
                <TableCell sx={{ textAlign: 'right', fontWeight: 600 }}>{f.cvssScore ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {meta && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Page {meta.page} of {totalPages}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="small" variant="outlined" disabled={page * perPage >= (meta.total ?? 0)} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

function SortableCell({
  label, col, cur, ord, onSort, align,
}: {
  label: string; col: string; cur: string; ord: string; onSort: (c: string) => void; align?: 'right';
}) {
  const active = cur === col;
  return (
    <TableCell
      sx={{ cursor: 'pointer', userSelect: 'none', textAlign: align }}
      onClick={() => onSort(col)}
    >
      <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={align === 'right' ? 'flex-end' : 'flex-start'}>
        <span>{label}</span>
        {active && (ord === 'asc' ? <ArrowUpwardIcon sx={{ fontSize: 14 }} /> : <ArrowDownwardIcon sx={{ fontSize: 14 }} />)}
      </Stack>
    </TableCell>
  );
}
