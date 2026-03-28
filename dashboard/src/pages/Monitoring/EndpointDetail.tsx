import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, Stack, Paper, Skeleton, Alert,
  IconButton, Tooltip,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  useEndpointDetail, useTriggerEndpointCheck,
  type Heartbeat, type UptimePeriod,
} from '../../api/hooks.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEAT_COLORS: Record<string, string> = {
  up: '#16a34a',
  degraded: '#f59e0b',
  down: '#dc2626',
};

const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  healthy: { color: '#16a34a', text: 'Up' },
  unhealthy: { color: '#f59e0b', text: 'Degraded' },
  unreachable: { color: '#dc2626', text: 'Down' },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EndpointDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useEndpointDetail(id ?? '');
  const triggerCheck = useTriggerEndpointCheck();

  const ep = query.data?.data;

  if (query.isLoading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={80} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={200} />
      </Box>
    );
  }

  if (!ep) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>Back</Button>
        <Alert severity="error">Endpoint not found</Alert>
      </Box>
    );
  }

  const statusInfo = STATUS_LABEL[ep.lastStatus ?? ''] ?? { color: '#9e9e9e', text: 'Pending' };
  const heartbeats = ep.heartbeats ?? [];
  const uptime = ep.uptime ?? {};
  const responseHistory = ep.responseHistory ?? [];

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: statusInfo.color, flexShrink: 0 }} />
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {ep.host}{ep.port !== 443 ? `:${ep.port}` : ''}
            </Typography>
            <Chip label={statusInfo.text} size="small" sx={{ bgcolor: statusInfo.color, color: '#fff', fontWeight: 600 }} />
          </Stack>
          {ep.label && <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>{ep.label}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {ep.project && (
            <Chip
              icon={<FolderIcon />}
              label={ep.project.name}
              variant="outlined"
              component={Link}
              to={`/projects/${ep.project.id}`}
              clickable
            />
          )}
          <Tooltip title="Check now">
            <IconButton onClick={() => triggerCheck.mutate(ep.id)} disabled={triggerCheck.isPending}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {/* Uptime cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        {(['24h', '7d', '30d'] as const).map((period) => {
          const u = uptime[period];
          if (!u) return null;
          return <UptimeCard key={period} period={period} data={u} />;
        })}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">Check Interval</Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{ep.checkInterval}</Typography>
        </Paper>
        {ep.lastResponseMs != null && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Last Response</Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{ep.lastResponseMs}ms</Typography>
          </Paper>
        )}
        {heartbeats.length > 0 && heartbeats[heartbeats.length - 1].certDaysLeft != null && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Cert Expires In</Typography>
            <Typography variant="h6" sx={{ fontWeight: 600, color: (heartbeats[heartbeats.length - 1].certDaysLeft ?? 999) <= 30 ? '#f59e0b' : 'text.primary' }}>
              {heartbeats[heartbeats.length - 1].certDaysLeft} days
            </Typography>
          </Paper>
        )}
      </Box>

      {/* Tags */}
      {Object.keys(ep.tags ?? {}).length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
          {Object.entries(ep.tags).map(([k, v]) => (
            <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
          ))}
        </Stack>
      )}

      {/* Heartbeat bar */}
      {heartbeats.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">Heartbeat</Typography>
            <Typography variant="caption" color="text.secondary">
              {heartbeats.length} checks
            </Typography>
          </Stack>
          <HeartbeatBar beats={heartbeats} />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {new Date(heartbeats[0].createdAt).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(heartbeats[heartbeats.length - 1].createdAt).toLocaleString()}
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Response time chart */}
      {responseHistory.length > 1 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Response Time</Typography>
          <ResponseTimeChart data={responseHistory} />
        </Paper>
      )}

      {/* Recent checks table */}
      {heartbeats.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Recent Checks</Typography>
          <Stack spacing={0.5}>
            {[...heartbeats].reverse().slice(0, 20).map((beat) => (
              <Stack
                key={beat.id}
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ py: 0.75, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <Box sx={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  bgcolor: BEAT_COLORS[beat.status] ?? '#9e9e9e',
                }} />
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 60 }}>
                  {beat.status === 'up' ? 'Up' : beat.status === 'degraded' ? 'Degraded' : 'Down'}
                </Typography>
                {beat.statusCode && (
                  <Chip label={`HTTP ${beat.statusCode}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {beat.message ?? ''}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {beat.responseMs}ms
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(beat.createdAt).toLocaleTimeString()}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {heartbeats.length === 0 && (
        <Paper sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No checks recorded yet. First check is in progress...</Typography>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Uptime card
// ---------------------------------------------------------------------------

function UptimeCard({ period, data }: { period: string; data: UptimePeriod }) {
  const color = data.pct >= 99 ? '#16a34a' : data.pct >= 95 ? '#f59e0b' : '#dc2626';
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">Uptime ({period})</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, color }}>
        {data.pct}%
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {data.up}/{data.total} checks | avg {data.avgResponseMs}ms
      </Typography>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Heartbeat bar — row of colored pills like Uptime Kuma
// ---------------------------------------------------------------------------

function HeartbeatBar({ beats }: { beats: Heartbeat[] }) {
  return (
    <Stack direction="row" spacing="2px" sx={{ height: 32, alignItems: 'stretch' }}>
      {beats.map((beat) => (
        <Tooltip
          key={beat.id}
          title={`${beat.status.toUpperCase()} — ${beat.responseMs}ms${beat.statusCode ? ` (HTTP ${beat.statusCode})` : ''}${beat.message ? ` — ${beat.message}` : ''} — ${new Date(beat.createdAt).toLocaleString()}`}
        >
          <Box
            sx={{
              flex: 1,
              minWidth: 3,
              maxWidth: 10,
              borderRadius: '2px',
              bgcolor: BEAT_COLORS[beat.status] ?? '#9e9e9e',
              transition: 'opacity 0.15s',
              '&:hover': { opacity: 0.7 },
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Response time chart — simple SVG line chart
// ---------------------------------------------------------------------------

function ResponseTimeChart({ data }: { data: Array<{ time: string; ms: number; status: string }> }) {
  const width = 700;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxMs = Math.max(...data.map((d) => d.ms), 1);
  const minMs = Math.min(...data.map((d) => d.ms), 0);
  const range = maxMs - minMs || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((d.ms - minMs) / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`;

  return (
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxHeight: 150 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padding.top + chartH * (1 - pct);
          const val = Math.round(minMs + range * pct);
          return (
            <g key={pct}>
              <line x1={padding.left} y1={y} x2={padding.left + chartW} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={padding.left - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{val}ms</text>
            </g>
          );
        })}
        {/* Area fill */}
        <path d={areaPath} fill="#3b82f6" opacity={0.1} />
        {/* Line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {/* Dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={2.5}
            fill={BEAT_COLORS[p.status] ?? '#3b82f6'}
          />
        ))}
      </svg>
    </Box>
  );
}
