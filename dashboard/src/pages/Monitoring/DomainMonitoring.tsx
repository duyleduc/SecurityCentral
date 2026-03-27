import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Alert, TextField,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Tabs, Tab, Select, MenuItem, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import LockIcon from '@mui/icons-material/Lock';
import { useMonitoredEndpoints, useAddEndpoints, useRemoveEndpoint, useTriggerEndpointCheck, type MonitoredEndpoint } from '../../api/hooks.js';

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  healthy: { color: '#16a34a', label: 'Healthy' },
  unhealthy: { color: '#dc2626', label: 'Unhealthy' },
  unreachable: { color: '#dc2626', label: 'Unreachable' },
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DomainMonitoringPage() {
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);

  const endpoints = useMonitoredEndpoints({ page, per_page: 50 });
  const data = (endpoints.data?.data ?? []) as MonitoredEndpoint[];
  const meta = endpoints.data?.meta;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
        <Box>
          <Typography variant="h5">Domain Monitoring</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor TLS certificates and endpoint reachability
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowAdd(!showAdd)}>
          Add Domains
        </Button>
      </Stack>

      {showAdd && <AddDomainsForm onDone={() => setShowAdd(false)} />}

      {/* Endpoint list */}
      <TableContainer component={Paper}>
        {endpoints.isLoading ? (
          <Box sx={{ p: 5 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="text" sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : data.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <LockIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>No domains monitored</Typography>
            <Typography variant="body2" color="text.secondary">
              Add domains to start monitoring their TLS certificates
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Endpoint</TableCell>
                <TableCell>Last Checked</TableCell>
                <TableCell align="right">Response</TableCell>
                <TableCell>Interval</TableCell>
                <TableCell sx={{ width: 160 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((ep) => (
                <EndpointRow key={ep.id} endpoint={ep} />
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Pagination */}
      {meta && meta.total > 50 && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Page {meta.page} of {Math.ceil(meta.total / 50)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="small" variant="outlined" disabled={page * 50 >= meta.total} onClick={() => setPage(page + 1)}>Next</Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

function AddDomainsForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [bulkText, setBulkText] = useState('');
  const [interval, setInterval] = useState('1h');
  const addMutation = useAddEndpoints();
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const handleSubmit = async () => {
    setResult(null);
    let endpointsList: Array<{ host: string; port: number }>;

    if (mode === 'single') {
      endpointsList = [{ host: host.trim(), port: parseInt(port, 10) || 443 }];
    } else {
      endpointsList = bulkText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [h, p] = line.split(':');
          return { host: h.trim(), port: parseInt(p, 10) || 443 };
        });
    }

    if (endpointsList.length === 0) return;

    try {
      const res = await addMutation.mutateAsync({ endpoints: endpointsList, checkInterval: interval });
      setResult(res.data as { created: number; errors: string[] });
      if ((res.data as any)?.created > 0) {
        setHost('');
        setPort('443');
        setBulkText('');
      }
    } catch (err) {
      setResult({ created: 0, errors: [(err as Error).message] });
    }
  };

  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <Tabs value={mode === 'single' ? 0 : 1} onChange={(_, v) => setMode(v === 0 ? 'single' : 'bulk')}>
            <Tab label="Single" />
            <Tab label="Bulk" />
          </Tabs>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: 'auto' }}>
            <Typography variant="caption" color="text.secondary">Check every:</Typography>
            <Select size="small" value={interval} onChange={(e) => setInterval(e.target.value)} sx={{ minWidth: 100 }}>
              <MenuItem value="1h">1 hour</MenuItem>
              <MenuItem value="6h">6 hours</MenuItem>
              <MenuItem value="24h">24 hours</MenuItem>
            </Select>
          </Stack>
        </Stack>

        {mode === 'single' ? (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
            <TextField
              size="small"
              placeholder="443"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              sx={{ width: 90 }}
            />
          </Stack>
        ) : (
          <Box>
            <TextField
              size="small"
              fullWidth
              multiline
              rows={5}
              placeholder={"example.com\napi.example.com:443\ninternal.corp.net:8443"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              sx={{ fontFamily: 'monospace' }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              One endpoint per line. Format: host or host:port (default 443)
            </Typography>
          </Box>
        )}

        {result && (
          <Alert severity={result.errors.length ? 'warning' : 'success'} sx={{ mt: 1.5 }}>
            {result.created > 0 && <span>{result.created} endpoint(s) added. </span>}
            {result.errors.map((e, i) => <Box key={i}>{e}</Box>)}
          </Alert>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button variant="outlined" onClick={onDone}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={addMutation.isPending || (mode === 'single' ? !host.trim() : !bulkText.trim())}
          >
            {addMutation.isPending ? 'Adding...' : 'Add'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

function EndpointRow({ endpoint: ep }: { endpoint: MonitoredEndpoint }) {
  const removeMutation = useRemoveEndpoint();
  const checkMutation = useTriggerEndpointCheck();

  const status = STATUS_CONFIG[ep.lastStatus ?? ''] ?? { color: '#999', label: ep.lastStatus ?? 'Pending' };

  return (
    <TableRow hover>
      <TableCell>
        <FiberManualRecordIcon sx={{ fontSize: 10, color: status.color }} />
      </TableCell>
      <TableCell>
        <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>{ep.host}</Typography>
        {ep.port !== 443 && (
          <Typography variant="body2" component="span" color="text.secondary">:{ep.port}</Typography>
        )}
        {ep.label && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>({ep.label})</Typography>
        )}
      </TableCell>
      <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>{relativeTime(ep.lastCheckedAt)}</TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
        {ep.lastResponseMs != null ? `${ep.lastResponseMs}ms` : '--'}
      </TableCell>
      <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{ep.checkInterval}</TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => checkMutation.mutate(ep.id)}
            disabled={checkMutation.isPending}
          >
            {checkMutation.isPending ? '...' : 'Check'}
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => { if (confirm(`Remove ${ep.host}?`)) removeMutation.mutate(ep.id); }}
          >
            Remove
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  );
}
