import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
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

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};

const STATUS_COLORS: Record<string, 'error' | 'warning' | 'success' | 'default'> = {
  open: 'error',
  in_progress: 'warning',
  resolved: 'success',
};

const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low', 'info'];
const STATUSES = ['all', 'open', 'in_progress', 'resolved'];
const SOURCES = ['all', 'code_scanner', 'infra_agent', 'cert_monitor'];

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function FindingsPage() {
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const filters: FindingsFilters = {
    ...(severity !== 'all' && { severity }),
    ...(status !== 'all' && { status }),
    ...(source !== 'all' && { source }),
    page: page + 1,
    limit: rowsPerPage,
  };

  const { data: findings, isLoading } = useFindings(filters);

  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Findings
      </Typography>

      {/* Filters */}
      <Stack direction="row" spacing={2} mb={3}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Severity</InputLabel>
          <Select value={severity} label="Severity" onChange={(e) => { setSeverity(e.target.value); setPage(0); }}>
            {SEVERITIES.map((s) => (
              <MenuItem key={s} value={s}>{formatLabel(s)}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Status</InputLabel>
          <Select value={status} label="Status" onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            {STATUSES.map((s) => (
              <MenuItem key={s} value={s}>{formatLabel(s)}</MenuItem>
            ))}
          </Select>
        </FormControl>
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
                <TableCell>Status</TableCell>
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
                  <TableRow key={f.id} hover>
                    <TableCell>
                      <Chip
                        label={f.severity}
                        size="small"
                        sx={{
                          bgcolor: SEVERITY_COLORS[f.severity] ?? '#6b7280',
                          color: '#fff',
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
                      <Chip
                        label={formatLabel(f.status)}
                        size="small"
                        color={STATUS_COLORS[f.status] ?? 'default'}
                      />
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
