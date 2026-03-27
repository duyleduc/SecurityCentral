import { useState } from 'react';
import {
  Box, Typography, Select, MenuItem, Button, Chip, Card, CardContent,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Stack, Alert, Grid,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CancelIcon from '@mui/icons-material/Cancel';
import { useScans, useScan, useCancelScan, type Scan } from '../../api/hooks.js';

const STATUS_CHIP: Record<string, { color: 'default' | 'primary' | 'success' | 'error' | 'warning'; label?: string }> = {
  pending: { color: 'default' },
  running: { color: 'primary' },
  completed: { color: 'success' },
  failed: { color: 'error' },
  cancelled: { color: 'default' },
};

export function ScansPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const params: Record<string, string | number> = { page, per_page: 25 };
  if (statusFilter) params.status = statusFilter;

  const scans = useScans(params);
  const data = scans.data?.data as Scan[] | undefined;
  const meta = scans.data?.meta;

  if (selectedId) return <ScanDetail scanId={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Scans</Typography>

      <Box sx={{ mb: 2 }}>
        <Select
          size="small"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          displayEmpty
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All Statuses</MenuItem>
          {['pending', 'running', 'completed', 'failed', 'cancelled'].map((s) => (
            <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>
          ))}
        </Select>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Trigger</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">New</TableCell>
              <TableCell align="right">Resolved</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {scans.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={8} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                  No scans
                </TableCell>
              </TableRow>
            ) : data.map((s) => {
              const chipProps = STATUS_CHIP[s.status] ?? STATUS_CHIP.pending;
              return (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
                  <TableCell>{s.scanType}</TableCell>
                  <TableCell>
                    <Chip label={s.status} size="small" color={chipProps.color} sx={{ textTransform: 'capitalize' }} />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{s.trigger}</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {s.startedAt ? new Date(s.startedAt).toLocaleString() : '-'}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {s.completedAt && s.startedAt
                      ? `${Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)}s`
                      : '-'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>{s.findingsTotal}</TableCell>
                  <TableCell align="right" sx={{ color: s.findingsNew > 0 ? 'error.main' : 'text.secondary' }}>
                    {s.findingsNew}
                  </TableCell>
                  <TableCell align="right" sx={{ color: s.findingsResolved > 0 ? 'success.main' : 'text.secondary' }}>
                    {s.findingsResolved}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {meta && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Page {meta.page} of {Math.ceil((meta.total ?? 0) / 25)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="small" variant="outlined" disabled={page * 25 >= (meta.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

function ScanDetail({ scanId, onBack }: { scanId: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useScan(scanId);
  const cancelScan = useCancelScan();
  const scan = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!scan) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography color="text.secondary">Not found</Typography>
      </Box>
    );
  }

  const status = scan.status as string;
  const chipProps = STATUS_CHIP[status] ?? STATUS_CHIP.pending;
  const canCancel = status === 'pending' || status === 'running';

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" onClick={onBack} sx={{ mb: 2 }}>
        Back to Scans
      </Button>

      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Box>
              <Chip label={status} size="small" color={chipProps.color} sx={{ textTransform: 'capitalize', mb: 1 }} />
              <Typography variant="h6">{scan.scanType as string}</Typography>
            </Box>
            {canCancel && (
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<CancelIcon />}
                onClick={() => cancelScan.mutate(scanId)}
                disabled={cancelScan.isPending}
              >
                {cancelScan.isPending ? 'Cancelling...' : 'Cancel Scan'}
              </Button>
            )}
          </Stack>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                Trigger
              </Typography>
              <Typography variant="body2">{scan.trigger as string}</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                Started
              </Typography>
              <Typography variant="body2">{scan.startedAt ? new Date(scan.startedAt as string).toLocaleString() : '-'}</Typography>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                Completed
              </Typography>
              <Typography variant="body2">{scan.completedAt ? new Date(scan.completedAt as string).toLocaleString() : '-'}</Typography>
            </Grid>
          </Grid>

          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <StatBox label="Total" value={scan.findingsTotal as number} />
            <StatBox label="New" value={scan.findingsNew as number} color="error.main" />
            <StatBox label="Resolved" value={scan.findingsResolved as number} color="success.main" />
          </Stack>

          {scan.errorMessage && (
            <Alert severity="error">
              <strong>Error:</strong> {scan.errorMessage as string}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Box sx={{ bgcolor: 'background.default', borderRadius: 1.5, p: 2, textAlign: 'center', minWidth: 80 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, color: color ?? 'text.primary' }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}
