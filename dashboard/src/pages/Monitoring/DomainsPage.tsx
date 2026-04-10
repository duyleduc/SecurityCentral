import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Alert, TextField,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Tabs, Tab, Select, MenuItem, IconButton, Tooltip, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import LockIcon from '@mui/icons-material/Lock';
import { useEndpoints, useCreateEndpoint, useDeleteEndpoint, useTriggerCheck, useProjects } from '../../api/hooks';
import { useRealtimeHeartbeat } from '../../ws/useRealtimeHeartbeat';

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  healthy: { color: '#16a34a', label: 'Healthy' },
  degraded: { color: '#d97706', label: 'Degraded' },
  down: { color: '#dc2626', label: 'Down' },
  pending: { color: '#9e9e9e', label: 'Pending' },
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

export function DomainsPage() {
  const { data: endpoints, isLoading } = useEndpoints();
  const { data: projects } = useProjects();
  const createEndpoint = useCreateEndpoint();
  const deleteEndpoint = useDeleteEndpoint();
  const triggerCheck = useTriggerCheck();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; host: string } | null>(null);

  // Subscribe to real-time heartbeat updates
  useRealtimeHeartbeat();

  const healthy = endpoints?.filter((e) => e.status === 'healthy').length ?? 0;
  const total = endpoints?.length ?? 0;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
        <Box>
          <Typography variant="h5">Domain Monitoring</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {total > 0 ? `${healthy}/${total} healthy` : 'Monitor TLS certificates and endpoint reachability'}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowAdd(!showAdd)}>
          Add Domains
        </Button>
      </Stack>

      {showAdd && <AddDomainsForm projects={projects ?? []} onDone={() => setShowAdd(false)} />}

      {/* Endpoint table */}
      <TableContainer component={Paper}>
        {isLoading ? (
          <Box sx={{ p: 5 }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="text" sx={{ mb: 1 }} />)}
          </Box>
        ) : !endpoints?.length ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <LockIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>No domains monitored</Typography>
            <Typography variant="body2" color="text.secondary">Add domains to start monitoring</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 30 }} />
                <TableCell>Endpoint</TableCell>
                <TableCell align="center">SSL</TableCell>
                <TableCell>Last Checked</TableCell>
                <TableCell align="right">Response</TableCell>
                <TableCell>Interval</TableCell>
                <TableCell sx={{ width: 100 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {endpoints.map((ep) => {
                const cfg = STATUS_CONFIG[ep.status] ?? STATUS_CONFIG.pending;
                const lastHb = ep.heartbeats?.[0];
                const sslDays = lastHb?.sslDaysLeft;

                return (
                  <TableRow
                    key={ep.id} hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/domains/${ep.id}`)}
                  >
                    <TableCell>
                      <FiberManualRecordIcon sx={{ fontSize: 10, color: cfg.color }} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="body2" fontWeight={500}>{ep.host}</Typography>
                          {ep.port !== 443 && (
                            <Typography variant="caption" color="text.secondary">:{ep.port}</Typography>
                          )}
                        </Box>
                        {ep.project && (
                          <Chip label={ep.project.name} size="small" variant="outlined" sx={{ fontSize: '0.7rem', ml: 1 }} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <SslBadge daysLeft={sslDays} valid={lastHb?.sslValid} />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                      {relativeTime(ep.lastCheckAt)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {lastHb?.responseMs != null ? `${lastHb.responseMs}ms` : '--'}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                      {(ep as any).uptimeInterval ?? 15}s
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Check now">
                          <IconButton size="small" onClick={() => triggerCheck.mutate(ep.id)} disabled={triggerCheck.isPending}>
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove">
                          <IconButton
                            size="small"
                            onClick={() => setDeleteTarget({ id: ep.id, host: ep.host })}
                            sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Remove confirmation dialog */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Domain</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to remove <strong>{deleteTarget?.host}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            All heartbeat history for this endpoint will be deleted. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="contained" color="error"
            onClick={() => { deleteEndpoint.mutate(deleteTarget!.id); setDeleteTarget(null); }}
            disabled={deleteEndpoint.isPending}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SSL Badge — mini grade indicator
// ---------------------------------------------------------------------------

function SslBadge({ daysLeft, valid }: { daysLeft?: number | null; valid?: boolean | null }) {
  if (valid == null) {
    return <Typography variant="caption" color="text.disabled">--</Typography>;
  }
  const expired = daysLeft != null && daysLeft <= 0;
  const warning = daysLeft != null && daysLeft <= 30 && !expired;
  const color = !valid || expired ? '#dc2626' : warning ? '#d97706' : '#16a34a';
  const label = !valid || expired ? 'F' : warning ? 'B' : 'A';

  return (
    <Tooltip title={!valid ? 'Invalid certificate' : expired ? 'Certificate expired' : `${daysLeft} days remaining`}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: '50%',
        border: `2px solid ${color}`, fontWeight: 800, fontSize: '0.7rem', color,
      }}>
        {label}
      </Box>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Add Domains Form — single + bulk tabs
// ---------------------------------------------------------------------------

function AddDomainsForm({ projects, onDone }: { projects: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [bulkText, setBulkText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [interval, setInterval] = useState(15);
  const [timeout, setTimeout] = useState(30);
  const createEndpoint = useCreateEndpoint();
  const [result, setResult] = useState<{ count: number; error?: string } | null>(null);

  const handleSubmit = async () => {
    setResult(null);
    const hosts = mode === 'single'
      ? [{ host: host.trim(), port: parseInt(port, 10) || 443 }]
      : bulkText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [h, p] = l.split(':');
          return { host: h.trim(), port: parseInt(p, 10) || 443 };
        });

    if (hosts.length === 0) return;

    let created = 0;
    for (const h of hosts) {
      try {
        await createEndpoint.mutateAsync({
          host: h.host,
          port: h.port,
          projectId: projectId || undefined,
          uptimeInterval: interval,
          uptimeTimeout: timeout,
        });
        created++;
      } catch (err) {
        setResult({ count: created, error: (err as Error).message });
        return;
      }
    }
    setResult({ count: created });
    setHost(''); setPort('443'); setBulkText('');
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
            <TextField size="small" type="number" label="Interval (s)" value={interval}
              onChange={(e) => setInterval(Number(e.target.value))} sx={{ width: 100 }}
              inputProps={{ min: 5, max: 3600 }} />
            <TextField size="small" type="number" label="Timeout (s)" value={timeout}
              onChange={(e) => setTimeout(Number(e.target.value))} sx={{ width: 100 }}
              inputProps={{ min: 5, max: 120 }} />
          </Stack>
        </Stack>

        {mode === 'single' ? (
          <Stack direction="row" spacing={1}>
            <TextField size="small" fullWidth placeholder="example.com" value={host}
              onChange={(e) => setHost(e.target.value)} />
            <TextField size="small" placeholder="443" value={port}
              onChange={(e) => setPort(e.target.value)} sx={{ width: 90 }} />
          </Stack>
        ) : (
          <Box>
            <TextField size="small" fullWidth multiline rows={4}
              placeholder={"example.com\napi.example.com:443\ninternal.corp.net:8443"}
              value={bulkText} onChange={(e) => setBulkText(e.target.value)}
              sx={{ fontFamily: 'monospace' }} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              One per line. Format: host or host:port (default 443)
            </Typography>
          </Box>
        )}

        {projects.length > 0 && (
          <FormControl size="small" sx={{ mt: 1.5, minWidth: 200 }}>
            <InputLabel>Project (optional)</InputLabel>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} label="Project (optional)">
              <MenuItem value="">None</MenuItem>
              {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
        )}

        {result && (
          <Alert severity={result.error ? 'warning' : 'success'} sx={{ mt: 1.5 }} onClose={() => setResult(null)}>
            {result.count > 0 && <span>{result.count} endpoint(s) added. </span>}
            {result.error && <span>{result.error}</span>}
          </Alert>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button variant="outlined" onClick={onDone}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit}
            disabled={createEndpoint.isPending || (mode === 'single' ? !host.trim() : !bulkText.trim())}>
            {createEndpoint.isPending ? 'Adding...' : 'Add'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
