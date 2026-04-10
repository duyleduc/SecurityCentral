import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Paper,
  CircularProgress, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip, IconButton, Collapse,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SecurityIcon from '@mui/icons-material/Security';
import LockIcon from '@mui/icons-material/Lock';
import SettingsIcon from '@mui/icons-material/Settings';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useEndpoint, useHeartbeats, useTriggerCheck, useUpdateEndpoint } from '../../api/hooks';
import { useRealtimeHeartbeat } from '../../ws/useRealtimeHeartbeat';

const BEAT_COLORS: Record<string, string> = { up: '#16a34a', degraded: '#f59e0b', down: '#dc2626' };
const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  healthy: { color: '#16a34a', text: 'Up' },
  degraded: { color: '#d97706', text: 'Degraded' },
  down: { color: '#dc2626', text: 'Down' },
  pending: { color: '#9e9e9e', text: 'Pending' },
};

export function DomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: endpoint, isLoading } = useEndpoint(id ?? '');
  const { data: heartbeats } = useHeartbeats(id ?? '', 100);
  const triggerCheck = useTriggerCheck();
  const updateEndpoint = useUpdateEndpoint();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editInterval, setEditInterval] = useState(15);
  const [editTimeout, setEditTimeout] = useState(30);

  // Subscribe to real-time heartbeat updates for this endpoint
  useRealtimeHeartbeat(id);

  const uptimeBeats = useMemo(() => (heartbeats ?? []).filter((h) => h.sslValid == null), [heartbeats]);

  if (isLoading) return <CircularProgress />;
  if (!endpoint) return <Typography>Endpoint not found</Typography>;

  const ep = endpoint as any;
  const statusInfo = STATUS_LABEL[ep.status] ?? STATUS_LABEL.pending;
  const sslHb = heartbeats?.find((h) => h.sslValid != null);
  const upCount = uptimeBeats.filter((h) => h.isUp).length;
  const latestBeat = uptimeBeats[0];

  // Uptime percentages
  const uptimePct = uptimeBeats.length > 0 ? ((upCount / uptimeBeats.length) * 100).toFixed(1) : null;
  const avgMs = uptimeBeats.length > 0
    ? Math.round(uptimeBeats.reduce((s, h) => s + (h.responseMs ?? 0), 0) / uptimeBeats.length)
    : null;

  const openSettings = () => {
    setEditInterval(ep.uptimeInterval ?? 15);
    setEditTimeout(ep.uptimeTimeout ?? 30);
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    await updateEndpoint.mutateAsync({ id: id!, uptimeInterval: editInterval, uptimeTimeout: editTimeout });
    setSettingsOpen(false);
  };

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate('/domains')}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: statusInfo.color, flexShrink: 0 }} />
            <Typography variant="h5" fontWeight={600}>
              {ep.host}{ep.port !== 443 ? `:${ep.port}` : ''}
            </Typography>
            <Chip label={statusInfo.text} size="small" sx={{ bgcolor: statusInfo.color, color: '#fff', fontWeight: 600 }} />
          </Stack>
          {ep.project && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>{ep.project.name}</Typography>
          )}
        </Box>
        <Button variant="outlined" size="small" startIcon={<SettingsIcon />} onClick={openSettings}>Settings</Button>
        <Button
          variant="contained" size="small"
          startIcon={triggerCheck.isPending ? <CircularProgress size={16} color="inherit" /> : <SecurityIcon />}
          onClick={() => triggerCheck.mutate(id!)}
          disabled={triggerCheck.isPending}
        >
          {triggerCheck.isPending ? 'Scanning...' : 'Run Check'}
        </Button>
      </Stack>

      {/* Summary cards row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 3 }}>
        <SslScoreCard ssl={sslHb} />
        <SummaryCard label="Uptime" value={uptimePct ? `${uptimePct}%` : '--'}
          color={uptimePct == null ? '#9e9e9e' : Number(uptimePct) >= 99 ? '#16a34a' : Number(uptimePct) >= 95 ? '#d97706' : '#dc2626'}
          sub={`${upCount}/${uptimeBeats.length} checks`} />
        <SummaryCard label="Avg Response" value={avgMs != null ? `${avgMs}ms` : '--'} sub="across all checks" />
        <SummaryCard label="Check Interval" value={`${ep.uptimeInterval ?? 15}s`} sub={`Timeout: ${ep.uptimeTimeout ?? 30}s`} />
        {sslHb?.sslDaysLeft != null && (
          <SummaryCard label="Cert Expires In" value={`${sslHb.sslDaysLeft}d`}
            color={sslHb.sslDaysLeft <= 7 ? '#dc2626' : sslHb.sslDaysLeft <= 30 ? '#d97706' : '#16a34a'}
            sub={sslHb.sslExpiry ? new Date(sslHb.sslExpiry).toLocaleDateString() : ''} />
        )}
        {latestBeat?.responseMs != null && (
          <SummaryCard label="Last Response" value={`${latestBeat.responseMs}ms`}
            color={latestBeat.responseMs < 300 ? '#16a34a' : latestBeat.responseMs < 1000 ? '#d97706' : '#dc2626'}
            sub={`HTTP ${latestBeat.statusCode ?? '?'}`} />
        )}
      </Box>

      {/* SSL Certificate details */}
      {sslHb && <SslDetailsCard ssl={sslHb} />}

      {/* Heartbeat bar */}
      {uptimeBeats.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">Heartbeat</Typography>
            <Typography variant="caption" color="text.secondary">{uptimeBeats.length} checks</Typography>
          </Stack>
          <HeartbeatBar beats={uptimeBeats} />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {new Date(uptimeBeats[uptimeBeats.length - 1]?.createdAt).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(uptimeBeats[0]?.createdAt).toLocaleString()}
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Response time chart */}
      {uptimeBeats.length > 1 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Response Time</Typography>
          <ResponseTimeChart data={uptimeBeats} />
        </Paper>
      )}

      {uptimeBeats.length === 0 && !isLoading && (
        <Paper sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No checks recorded yet. First check is in progress...</Typography>
        </Paper>
      )}

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Uptime Check Settings</DialogTitle>
        <DialogContent>
          <TextField fullWidth type="number" label="Check interval (seconds)" value={editInterval}
            onChange={(e) => setEditInterval(Number(e.target.value))} margin="normal"
            inputProps={{ min: 5, max: 3600 }} helperText="How often to ping (5–3600s)" />
          <TextField fullWidth type="number" label="Timeout (seconds)" value={editTimeout}
            onChange={(e) => setEditTimeout(Number(e.target.value))} margin="normal"
            inputProps={{ min: 5, max: 120 }} helperText="Max wait before marking down (5–120s)" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveSettings} disabled={updateEndpoint.isPending}>
            {updateEndpoint.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 600, color: color ?? 'text.primary' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// SSL Score card
// ---------------------------------------------------------------------------

function SslScoreCard({ ssl }: { ssl: any }) {
  if (!ssl) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">SSL Score</Typography>
        <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.disabled' }}>--</Typography>
        <Typography variant="caption" color="text.disabled">Not scanned yet</Typography>
      </Paper>
    );
  }

  const valid = ssl.sslValid;
  const days = ssl.sslDaysLeft ?? 999;
  const expired = days <= 0;
  const grade = !valid || expired ? 'F' : days <= 7 ? 'C' : days <= 30 ? 'B' : 'A';
  const color = grade === 'F' ? '#991b1b' : grade === 'C' ? '#c2410c' : grade === 'B' ? '#a16207' : '#16a34a';
  const bg = grade === 'F' ? '#fef2f2' : grade === 'C' ? '#fff7ed' : grade === 'B' ? '#fefce8' : '#f0fdf4';

  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: color + '60', bgcolor: bg }}>
      <Typography variant="caption" color="text.secondary">SSL Score</Typography>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{
          width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: color, color: '#fff', fontWeight: 800, fontSize: '1rem',
          boxShadow: `0 0 0 3px ${color}22`,
        }}>
          {grade}
        </Box>
        <Typography variant="caption" sx={{ color, fontWeight: 500 }}>
          {grade === 'F' ? 'Critical' : grade === 'C' ? 'Weak' : grade === 'B' ? 'Expiring soon' : 'Strong'}
        </Typography>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// SSL Details — expandable certificate info
// ---------------------------------------------------------------------------

function SslDetailsCard({ ssl }: { ssl: any }) {
  const [expanded, setExpanded] = useState(true);
  const valid = ssl.sslValid;
  const days = ssl.sslDaysLeft;
  const color = !valid ? '#dc2626' : (days ?? 999) <= 30 ? '#d97706' : '#16a34a';

  return (
    <Paper variant="outlined" sx={{ mb: 3, borderColor: color + '40' }}>
      <Stack
        direction="row" alignItems="center" spacing={1.5}
        sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
        onClick={() => setExpanded(!expanded)}
      >
        <LockIcon sx={{ color }} />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          SSL Certificate {valid ? 'Valid' : 'Invalid'}
        </Typography>
        {ssl.tlsVersion && <Chip label={ssl.tlsVersion} size="small" variant="outlined" />}
        {days != null && (
          <Chip label={`${days}d left`} size="small" sx={{
            bgcolor: days <= 7 ? '#fee2e2' : days <= 30 ? '#fef3c7' : '#dcfce7',
            color: days <= 7 ? '#dc2626' : days <= 30 ? '#d97706' : '#16a34a',
            fontWeight: 600,
          }} />
        )}
        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </Stack>

      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Issuer</Typography>
            <Typography variant="body2">{ssl.sslIssuer ?? '-'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Expires</Typography>
            <Typography variant="body2" sx={{ color }}>
              {ssl.sslExpiry ? new Date(ssl.sslExpiry).toLocaleDateString() : '-'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">TLS Version</Typography>
            <Typography variant="body2">{ssl.tlsVersion ?? '-'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">SPF</Typography>
            <Typography variant="body2" color={ssl.dnsSpf === 'pass' ? 'success.main' : 'error.main'}>
              {ssl.dnsSpf === 'pass' ? 'OK' : 'Missing'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">DKIM</Typography>
            <Typography variant="body2" color={ssl.dnsDkim === 'pass' ? 'success.main' : 'error.main'}>
              {ssl.dnsDkim === 'pass' ? 'OK' : 'Missing'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">DMARC</Typography>
            <Typography variant="body2" color={ssl.dnsDmarc === 'pass' ? 'success.main' : 'error.main'}>
              {ssl.dnsDmarc === 'pass' ? 'OK' : 'Missing'}
            </Typography>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Heartbeat bar — colored pills like Uptime Kuma / v1
// ---------------------------------------------------------------------------

function HeartbeatBar({ beats }: { beats: any[] }) {
  const reversed = useMemo(() => [...beats].reverse(), [beats]);
  return (
    <Stack direction="row" spacing="2px" sx={{ height: 32, alignItems: 'stretch' }}>
      {reversed.map((beat: any) => (
        <Tooltip
          key={beat.id}
          title={`${beat.isUp ? 'UP' : 'DOWN'} — ${beat.responseMs ?? '?'}ms${beat.statusCode ? ` (HTTP ${beat.statusCode})` : ''}${beat.error ? ` — ${beat.error}` : ''} — ${new Date(beat.createdAt).toLocaleString()}`}
        >
          <Box sx={{
            flex: 1, minWidth: 3, maxWidth: 10, borderRadius: '2px',
            bgcolor: beat.isUp ? '#16a34a' : '#dc2626',
            transition: 'opacity 0.15s', '&:hover': { opacity: 0.7 },
          }} />
        </Tooltip>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Response time SVG chart — line + area like v1
// ---------------------------------------------------------------------------

function ResponseTimeChart({ data }: { data: any[] }) {
  const reversed = useMemo(() => [...data].reverse(), [data]);
  const width = 700;
  const height = 120;
  const pad = { top: 10, right: 10, bottom: 20, left: 45 };
  const cW = width - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;

  const vals = reversed.map((d: any) => d.responseMs ?? 0);
  const maxMs = Math.max(...vals, 1);
  const minMs = Math.min(...vals, 0);
  const range = maxMs - minMs || 1;

  const points = reversed.map((d: any, i: number) => ({
    x: pad.left + (i / Math.max(reversed.length - 1, 1)) * cW,
    y: pad.top + cH - (((d.responseMs ?? 0) - minMs) / range) * cH,
    isUp: d.isUp,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${pad.top + cH} L ${points[0].x} ${pad.top + cH} Z`;

  return (
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxHeight: 150 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = pad.top + cH * (1 - pct);
          const val = Math.round(minMs + range * pct);
          return (
            <g key={pct}>
              <line x1={pad.left} y1={y} x2={pad.left + cW} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={pad.left - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{val}ms</text>
            </g>
          );
        })}
        <path d={areaPath} fill="#3b82f6" opacity={0.1} />
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={p.isUp ? '#3b82f6' : '#dc2626'} />
        ))}
      </svg>
    </Box>
  );
}
