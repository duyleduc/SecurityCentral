import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Alert, TextField,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Tabs, Tab, Select, MenuItem, Divider, IconButton, Tooltip,
  Checkbox, ListItemText, OutlinedInput, InputAdornment,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useMonitoredEndpoints, useAddEndpoints, useRemoveEndpoint, useTriggerEndpointCheck, useProjects, type MonitoredEndpoint, type Project, type TlsScanInfo } from '../../api/hooks.js';

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

export function DomainMonitoringPage({ embedded = false }: { embedded?: boolean }) {
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [tagsQuery, setTagsQuery] = useState('');

  const projectsQuery = useProjects();
  const projects = (projectsQuery.data?.data ?? []) as Project[];

  const params: Record<string, string | number> = { page, per_page: 50 };
  if (selectedProjects.length > 0) params.project_ids = selectedProjects.join(',');
  if (tagsQuery.trim()) params.tags = tagsQuery.trim();

  const endpoints = useMonitoredEndpoints(params);
  const data = (endpoints.data?.data ?? []) as MonitoredEndpoint[];
  const meta = endpoints.data?.meta;

  const handleProjectChange = (e: SelectChangeEvent<string[]>) => {
    const val = e.target.value;
    setSelectedProjects(typeof val === 'string' ? val.split(',') : val);
    setPage(1);
  };

  const hasFilters = selectedProjects.length > 0 || tagsQuery.trim();

  return (
    <Box>
      {embedded ? (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">Domains</Typography>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setShowAdd(!showAdd)}>
            Add Domains
          </Button>
        </Stack>
      ) : (
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
      )}

      {showAdd && <AddDomainsForm onDone={() => setShowAdd(false)} />}

      {/* Filters */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          size="small"
          multiple
          value={selectedProjects}
          onChange={handleProjectChange}
          displayEmpty
          input={<OutlinedInput size="small" />}
          renderValue={(selected) => {
            if (selected.length === 0) return <Typography variant="body2" color="text.secondary">All Projects</Typography>;
            return selected.map((id) => projects.find((p) => p.id === id)?.name ?? id).join(', ');
          }}
          sx={{ minWidth: 200 }}
        >
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              <Checkbox size="small" checked={selectedProjects.includes(p.id)} />
              <ListItemText primary={p.name} />
            </MenuItem>
          ))}
        </Select>

        <TextField
          size="small"
          placeholder="Tags: env=prod,team=infra"
          value={tagsQuery}
          onChange={(e) => { setTagsQuery(e.target.value); setPage(1); }}
          sx={{ minWidth: 240 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
        />

        {hasFilters && (
          <Button
            size="small"
            startIcon={<ClearIcon />}
            onClick={() => { setSelectedProjects([]); setTagsQuery(''); setPage(1); }}
          >
            Clear
          </Button>
        )}
      </Stack>

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
                <TableCell align="center">SSL</TableCell>
                <TableCell>Tags</TableCell>
                <TableCell>Last Checked</TableCell>
                <TableCell align="right">Response</TableCell>
                <TableCell>Interval</TableCell>
                <TableCell sx={{ width: 120 }} />
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
      {meta && (meta.total ?? 0) > 50 && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Page {meta.page} of {Math.ceil((meta.total ?? 0) / 50)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="small" variant="outlined" disabled={page * 50 >= (meta.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
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
  const [interval, setInterval] = useState('1m');
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
              <MenuItem value="30s">30 seconds</MenuItem>
              <MenuItem value="1m">1 minute</MenuItem>
              <MenuItem value="5m">5 minutes</MenuItem>
              <MenuItem value="15m">15 minutes</MenuItem>
              <MenuItem value="30m">30 minutes</MenuItem>
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
  const navigate = useNavigate();
  const removeMutation = useRemoveEndpoint();
  const checkMutation = useTriggerEndpointCheck();

  const status = STATUS_CONFIG[ep.lastStatus ?? ''] ?? { color: '#999', label: ep.lastStatus ?? 'Pending' };
  const tags = ep.tags ?? {};

  return (
    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/monitoring/domains/${ep.id}`)}>
      <TableCell>
        <FiberManualRecordIcon sx={{ fontSize: 10, color: status.color }} />
      </TableCell>
      <TableCell>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>{ep.host}</Typography>
            {ep.port !== 443 && (
              <Typography variant="body2" component="span" color="text.secondary">:{ep.port}</Typography>
            )}
            {ep.label && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>({ep.label})</Typography>
            )}
          </Box>
          {ep.project && (
            <Chip
              label={ep.project.name}
              size="small"
              variant="outlined"
              component={Link}
              to={`/projects/${ep.project.id}`}
              clickable
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              sx={{ fontSize: '0.7rem', ml: 1 }}
            />
          )}
        </Stack>
      </TableCell>
      <TableCell align="center">
        <SslGradeBadge tls={ep.lastTlsInfo} />
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {Object.entries(tags).map(([k, v]) => (
            <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
          ))}
        </Stack>
      </TableCell>
      <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>{relativeTime(ep.lastCheckedAt)}</TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
        {ep.lastResponseMs != null ? `${ep.lastResponseMs}ms` : '--'}
      </TableCell>
      <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{ep.checkInterval}</TableCell>
      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Check now">
            <IconButton
              size="small"
              onClick={() => checkMutation.mutate(ep.id)}
              disabled={checkMutation.isPending}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove">
            <IconButton
              size="small"
              onClick={() => { if (confirm(`Remove ${ep.host}?`)) removeMutation.mutate(ep.id); }}
              sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// SSL Grade computation + badge
// ---------------------------------------------------------------------------

function computeSslGrade(tls: TlsScanInfo): { grade: string; color: string; bg: string } {
  const isWeakProtocol = tls.tlsVersion ? ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'].includes(tls.tlsVersion) : false;
  const isSslProtocol = tls.tlsVersion ? tls.tlsVersion.startsWith('SSL') : false;
  const weakCiphers = ['RC4', '3DES', 'DES', 'EXPORT', 'NULL', 'ANON'];
  const isWeakCipher = tls.cipherName ? weakCiphers.some((wc) => tls.cipherName!.toUpperCase().includes(wc)) : false;
  const isWeakSig = tls.signatureAlgorithm ? ['SHA1', 'MD5'].some((w) => tls.signatureAlgorithm.toUpperCase().includes(w)) : false;
  const isMd5 = tls.signatureAlgorithm?.toUpperCase().includes('MD5');
  const isWeakKey = tls.keyBits != null && (
    (tls.keyAlgorithm.startsWith('RSA') && tls.keyBits < 2048) ||
    (tls.keyAlgorithm.startsWith('ECDSA') && tls.keyBits < 256)
  );
  const certExpired = (tls.certDaysLeft ?? 999) <= 0;

  const criticals = [isSslProtocol, certExpired, isMd5].filter(Boolean).length;
  const highs = [isWeakProtocol && !isSslProtocol, isWeakCipher, isWeakKey, isWeakSig && !isMd5, !certExpired && (tls.certDaysLeft ?? 999) <= 7].filter(Boolean).length;
  const mediums = [!tls.forwardSecrecy, !tls.hsts, !tls.chainValid, tls.isSelfSigned].filter(Boolean).length;

  if (criticals > 0) return { grade: 'F', color: '#991b1b', bg: '#fef2f2' };
  if (highs > 0) return { grade: 'C', color: '#c2410c', bg: '#fff7ed' };
  if (mediums > 2) return { grade: 'B-', color: '#a16207', bg: '#fefce8' };
  if (mediums > 0) return { grade: 'B+', color: '#1d4ed8', bg: '#eff6ff' };
  if (tls.tlsVersion === 'TLSv1.3' && tls.forwardSecrecy && tls.hsts) return { grade: 'A+', color: '#15803d', bg: '#f0fdf4' };
  return { grade: 'A', color: '#16a34a', bg: '#f0fdf4' };
}

function SslGradeBadge({ tls }: { tls: TlsScanInfo | null }) {
  if (!tls) {
    return (
      <Tooltip title="No SSL scan yet">
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>--</Typography>
      </Tooltip>
    );
  }

  const { grade, color, bg } = computeSslGrade(tls);

  return (
    <Tooltip title={`SSL Grade: ${grade} — click for details`}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: '50%',
        bgcolor: bg, border: `2px solid ${color}`,
        fontWeight: 800, fontSize: grade.length > 1 ? '0.65rem' : '0.8rem',
        color, lineHeight: 1, cursor: 'pointer',
      }}>
        {grade}
      </Box>
    </Tooltip>
  );
}
