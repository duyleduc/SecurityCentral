import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  Stack,
  CircularProgress,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  IconButton,
  TextField,
  MenuItem,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import FolderIcon from '@mui/icons-material/Folder';
import StorageIcon from '@mui/icons-material/Storage';
import MemoryIcon from '@mui/icons-material/Memory';
import DnsIcon from '@mui/icons-material/Dns';
import SecurityIcon from '@mui/icons-material/Security';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AssessmentIcon from '@mui/icons-material/Assessment';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useServer, useServerMetrics, useSecurityPosture, useServerVulnerabilities, usePackageInventory, useTriggerCveScan, useDeleteServer, useUpdateServer, useProjects, useAgentLatestVersion, useScoreHistory, useAttackSurfaceScan, useTriggerAttackSurfaceScan } from '../../api/hooks';
import type { CveFinding } from '../../api/hooks';
import type { SecurityPosture, ServerMetric } from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';
import { TagsInput, type Tag } from '../../components/TagsInput';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
] as const;

const GRID_STROKE = 'rgba(255,255,255,0.06)';
const AXIS_STROKE = 'rgba(255,255,255,0.3)';

function fmtTime(ts: number, hours: number): string {
  const d = new Date(ts);
  if (hours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

function fmtBytesShort(v: number): string {
  if (v >= 1048576) return `${(v / 1048576).toFixed(0)}M`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)}K`;
  return `${v}`;
}

// ---------------------------------------------------------------------------
// Gauge widget (Grafana-style semicircle)
// ---------------------------------------------------------------------------

interface GaugeProps {
  label: string;
  value: number | null;
  max?: number;
  unit?: string;
  /** Display text override (e.g. "6.8 hours") instead of value+unit */
  display?: string;
  /** Thresholds: [warn, crit]. Colors go green → yellow → red. */
  thresholds?: [number, number];
}

function Gauge({ label, value, max = 100, unit = '%', display, thresholds = [60, 85] }: GaugeProps) {
  const pct = value != null ? Math.min(Math.max(value / max, 0), 1) : 0;
  const hasValue = value != null;

  const w = 140, h = 110;
  const cx = w / 2, cy = 58, r = 44, strokeW = 10;
  const gapDeg = 90;
  const sweepDeg = 360 - gapDeg;
  const startDeg = 90 + gapDeg / 2;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const pointAt = (frac: number) => {
    const deg = startDeg + frac * sweepDeg;
    const rad = toRad(deg);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const arcBetween = (f1: number, f2: number) => {
    const s = pointAt(f1);
    const e = pointAt(f2);
    const sweep = (f2 - f1) * sweepDeg;
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  };

  // Threshold fractions (normalized to 0-1)
  const warnFrac = thresholds[0] / max;
  const critFrac = thresholds[1] / max;

  // Color for current value
  const normVal = value ?? 0;
  const valColor = normVal >= thresholds[1] ? '#ef4444'
    : normVal >= thresholds[0] ? '#f59e0b'
    : '#22c55e';

  // Needle position
  const needlePt = pointAt(pct);
  const displayText = display ?? (hasValue ? `${value % 1 === 0 ? value : value.toFixed(1)}${unit}` : '-');

  return (
    <Card sx={{
      bgcolor: 'rgba(15,23,42,0.7)', border: '1px solid', borderColor: 'divider',
      textAlign: 'center', px: 0.5, pt: 0, pb: 0.5, minWidth: 0, overflow: 'hidden',
    }}>
      {/* Label above gauge */}
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', display: 'block', pt: 0.75, pb: 0 }}>
        {label}
      </Typography>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', margin: '0 auto' }}>
        {/* Color-banded background track: green → yellow → red (dimmed) */}
        <path d={arcBetween(0, warnFrac)} fill="none" stroke="rgba(34,197,94,0.2)" strokeWidth={strokeW} strokeLinecap="butt" />
        <path d={arcBetween(warnFrac, critFrac)} fill="none" stroke="rgba(245,158,11,0.2)" strokeWidth={strokeW} strokeLinecap="butt" />
        <path d={arcBetween(critFrac, 1)} fill="none" stroke="rgba(239,68,68,0.2)" strokeWidth={strokeW} strokeLinecap="butt" />

        {/* Bright filled portion up to current value */}
        {hasValue && pct > 0.005 && (() => {
          const segments: JSX.Element[] = [];
          const stops = [
            { frac: Math.min(pct, warnFrac), color: '#22c55e' },
            { frac: Math.min(pct, critFrac), color: '#f59e0b' },
            { frac: pct, color: '#ef4444' },
          ];
          let prev = 0;
          for (const s of stops) {
            if (s.frac > prev) {
              segments.push(
                <path key={s.color + prev} d={arcBetween(prev, s.frac)} fill="none"
                  stroke={s.color} strokeWidth={strokeW} strokeLinecap="butt" />
              );
              prev = s.frac;
            }
          }
          return segments;
        })()}

        {/* Round caps at start and end of filled arc */}
        {hasValue && pct > 0.005 && (
          <>
            <circle cx={pointAt(0).x} cy={pointAt(0).y} r={strokeW / 2} fill="#22c55e" />
            <circle cx={needlePt.x} cy={needlePt.y} r={strokeW / 2} fill={valColor} />
          </>
        )}

        {/* Bright needle dot */}
        {hasValue && (
          <circle cx={needlePt.x} cy={needlePt.y} r={strokeW / 2 + 2} fill={valColor} opacity={0.9} />
        )}

        {/* Center value — large */}
        <text x={cx} y={cy + 6} textAnchor="middle" fill={hasValue ? '#e2e8f0' : 'rgba(255,255,255,0.3)'}
          fontSize="20" fontWeight="700" fontFamily="monospace">
          {displayText}
        </text>

        {/* Min / Max */}
        <text x={pointAt(0).x} y={pointAt(0).y + 14} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">0</text>
        <text x={pointAt(1).x} y={pointAt(1).y + 14} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">{max}</text>
      </svg>
    </Card>
  );
}

/** Static info gauge — just shows a value, no arc. */
function InfoGauge({ label, value }: { label: string; value: string }) {
  return (
    <Card sx={{
      bgcolor: 'rgba(15,23,42,0.7)', border: '1px solid', borderColor: 'divider',
      textAlign: 'center', px: 0.5, minWidth: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      height: 140,
    }}>
      <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.25rem', color: '#94a3b8' }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.625rem', mt: 1 }}>
        {label}
      </Typography>
    </Card>
  );
}

function fmtUptime(lastHeartbeat: string | null, createdAt: string): string {
  if (!lastHeartbeat) return '-';
  const ms = new Date(lastHeartbeat).getTime() - new Date(createdAt).getTime();
  if (ms < 0) return '-';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function fmtRam(mb: number | null | undefined): string {
  if (mb == null) return '-';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

// ---------------------------------------------------------------------------
// Shared tooltip (Grafana-style: dark, compact, shows timestamp)
// ---------------------------------------------------------------------------

interface PanelTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  hours: number;
  unit?: string;
  formatter?: (v: number) => string;
}

function PanelTooltip({ active, payload, label, hours, unit = '', formatter }: PanelTooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <Box sx={{
      bgcolor: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1,
      px: 1.5, py: 1, fontSize: '0.75rem', minWidth: 140,
    }}>
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block', mb: 0.5 }}>
        {new Date(label).toLocaleString()}
      </Typography>
      {payload.map((p) => (
        <Stack key={p.name} direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="caption" sx={{ color: p.color, fontWeight: 600 }}>{p.name}</Typography>
          <Typography variant="caption" sx={{ color: '#fff', fontFamily: 'monospace' }}>
            {formatter ? formatter(p.value) : `${p.value.toFixed(1)}${unit}`}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Grafana-style metric panel
// ---------------------------------------------------------------------------

interface MetricPanelProps {
  title: string;
  data: Array<Record<string, unknown>>;
  series: Array<{ key: string; color: string; label?: string }>;
  hours: number;
  unit?: string;
  yDomain?: [number, number | string];
  formatter?: (v: number) => string;
  yTickFmt?: (v: number) => string;
  threshold?: { value: number; color: string; label: string };
  height?: number;
  currentValue?: string;
  currentColor?: string;
  /** Shared crosshair timestamp from another panel (null = no crosshair). */
  crosshairTs?: number | null;
  /** Called when user hovers this panel — reports the active data-point timestamp. */
  onCrosshair?: (ts: number | null) => void;
}

function MetricPanel({
  title, data, series, hours, unit = '%', yDomain, formatter, yTickFmt,
  threshold, height = 200, currentValue, currentColor, crosshairTs, onCrosshair,
}: MetricPanelProps) {
  const theme = useTheme();
  const empty = data.length === 0;

  return (
    <Card sx={{
      bgcolor: alpha(theme.palette.background.paper, 0.6),
      border: '1px solid',
      borderColor: 'divider',
      overflow: 'hidden',
    }}>
      <CardContent sx={{ pb: '12px !important', pt: 1.5, px: 2 }}>
        {/* Panel header */}
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
          <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.secondary' }}>{title}</Typography>
          {currentValue && (
            <Typography variant="h6" sx={{ fontFamily: 'monospace', color: currentColor ?? 'text.primary', lineHeight: 1 }}>
              {currentValue}
            </Typography>
          )}
        </Stack>

        {empty ? (
          <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="caption" color="text.secondary">Waiting for data...</Typography>
          </Box>
        ) : (
          <Box
            sx={{ width: '100%', height }}
            onMouseLeave={() => onCrosshair?.(null)}
          >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 45, bottom: 0, left: 0 }}
              onMouseMove={(state: any) => {
                if (state?.activeLabel != null) onCrosshair?.(state.activeLabel as number);
              }}
              onMouseLeave={() => onCrosshair?.(null)}
            >
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => fmtTime(v, hours)}
                stroke={AXIS_STROKE}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                minTickGap={50}
              />
              <YAxis
                domain={yDomain ?? [0, 'auto']}
                stroke={AXIS_STROKE}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={yTickFmt ?? ((v: number) => `${v}${unit}`)}
                width={45}
              />
              <RechartsTooltip
                content={<PanelTooltip hours={hours} unit={unit} formatter={formatter} />}
                cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeDasharray: '4 4' }}
              />
              {threshold && (
                <ReferenceLine
                  y={threshold.value}
                  stroke={threshold.color}
                  strokeDasharray="6 3"
                  strokeOpacity={0.6}
                  label={{
                    value: threshold.label,
                    position: 'insideTopRight',
                    fill: threshold.color,
                    fontSize: 10,
                    offset: 4,
                  }}
                />
              )}
              {crosshairTs != null && (
                <ReferenceLine
                  x={crosshairTs}
                  stroke="rgba(255,255,255,0.35)"
                  strokeDasharray="3 3"
                  ifOverflow="extendDomain"
                />
              )}
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label ?? s.key}
                  stroke={s.color}
                  fill={`url(#grad-${s.key})`}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [hours, setHours] = useState(24);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [crosshairTs, setCrosshairTs] = useState<number | null>(null);
  const theme = useTheme();
  const { data: server, isLoading } = useServer(id ?? '');
  const { data: metrics } = useServerMetrics(id ?? '', hours);
  const { data: posture } = useSecurityPosture(id ?? '');
  const { data: vulns } = useServerVulnerabilities(id ?? '');
  const { data: projects } = useProjects();
  const { data: latestAgent } = useAgentLatestVersion();
  const { data: scoreHistory } = useScoreHistory(id ?? '');
  const deleteMutation = useDeleteServer();
  const updateMutation = useUpdateServer();

  // Transform metrics into timestamp-based chart data (once, memoized).
  const chartRows = useMemo(() =>
    (metrics ?? []).map((m) => ({
      ts: new Date(m.createdAt).getTime(),
      cpu: Math.round(m.cpu * 10) / 10,
      ioWait: m.cpuIoWait != null ? Math.round(m.cpuIoWait * 10) / 10 : 0,
      ram: Math.round(m.memory * 10) / 10,
      swap: m.swapUsedPct != null ? Math.round(m.swapUsedPct * 10) / 10 : 0,
      disk: Math.round(m.disk * 10) / 10,
      diskIoUtil: m.diskIoUtil != null ? Math.round(m.diskIoUtil * 10) / 10 : 0,
      diskRead: m.diskReadBps ?? 0,
      diskWrite: m.diskWriteBps ?? 0,
      netRx: m.netRxBps ?? 0,
      netTx: m.netTxBps ?? 0,
      load1: m.loadAvg1 ?? 0,
      load5: m.loadAvg5 ?? 0,
      load15: m.loadAvg15 ?? 0,
    })),
    [metrics],
  );

  const latest = metrics?.[metrics.length - 1];

  const cpuColor = (latest?.cpu ?? 0) > 85 ? 'error.main' : (latest?.cpu ?? 0) > 60 ? 'warning.main' : 'success.main';
  const ramColor = (latest?.memory ?? 0) > 85 ? 'error.main' : (latest?.memory ?? 0) > 60 ? 'warning.main' : 'success.main';
  const diskColor = (latest?.disk ?? 0) > 90 ? 'error.main' : (latest?.disk ?? 0) > 75 ? 'warning.main' : 'success.main';

  // Compute score from real findings + posture data
  const serverScore = useMemo(() => {
    const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const v of vulns ?? []) {
      if (sevCounts[v.severity] !== undefined) sevCounts[v.severity]++;
    }
    // Audit failures count as findings too
    const audits = (posture as any)?.auditResults ?? [];
    for (const a of audits) {
      if (a.status === 'fail' && sevCounts[a.severity] !== undefined) sevCounts[a.severity]++;
    }
    // Posture issues
    if (posture && !posture.firewallActive) sevCounts.high++;
    return computeScore(sevCounts);
  }, [vulns, posture]);

  if (isLoading) return <CircularProgress />;
  if (!server) return <Typography>Server not found</Typography>;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/servers')}>
          Back to Servers
        </Button>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<AssessmentIcon />}
            variant="contained"
            size="small"
            onClick={() => navigate(`/servers/${id}/report`)}
          >
            Full Report
          </Button>
          <Button
            startIcon={<EditIcon />}
            variant="outlined"
            size="small"
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
          <Button
            startIcon={<DeleteIcon />}
            color="error"
            variant={server.status === 'dead' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setDeleteOpen(true)}
          >
            {server.status === 'dead' ? 'Delete Server' : 'Delete'}
          </Button>
        </Stack>
      </Stack>

      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Stack alignItems="center" spacing={0.5}>
          <ScoreBadge score={server.securityScore ?? serverScore.score} breakdown={serverScore.breakdown} size="medium" />
          {/* Score trend sparkline */}
          {scoreHistory && scoreHistory.length > 1 && (
            <Box sx={{ width: 48, height: 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreHistory.map((h) => ({ s: h.score }))} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="s" stroke="#6366f1" strokeWidth={1.5} fill="url(#sparkGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Stack>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h4">{server.hostname}</Typography>
            <Chip
              label={server.status}
              color={server.status === 'online' ? 'success' : server.status === 'warning' ? 'warning' : 'error'}
            />
            {server.project && (
              <Chip icon={<FolderIcon sx={{ fontSize: 14 }} />} label={server.project.name} size="small" variant="outlined"
                onClick={() => navigate(`/projects/${server.project!.id}`)} />
            )}
            {server.agentVersion && <Chip label={`Agent v${server.agentVersion}`} variant="outlined" size="small" />}
          </Stack>
          {/* Score breakdown: CVE + audit counts */}
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
            {serverScore.breakdown.filter((b) => b.count > 0).map((b) => (
              <Chip key={b.severity} size="small" variant="outlined"
                label={`${b.count} ${b.severity} (−${b.deduction})`}
                color={b.severity === 'critical' ? 'error' : b.severity === 'high' ? 'warning' : b.severity === 'medium' ? 'info' : 'default'}
                sx={{ fontSize: '0.7rem', height: 22 }} />
            ))}
            {serverScore.breakdown.every((b) => b.count === 0) && (
              <Chip size="small" label="No issues" color="success" variant="outlined" sx={{ fontSize: '0.7rem', height: 22 }} />
            )}
          </Stack>
          {server.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              {server.tags.map((t) => (
                <Chip
                  key={t.key}
                  label={t.value ? `${t.key}: ${t.value}` : t.key}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem', borderColor: 'primary.dark' }}
                />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>

      {/* Agent update banner */}
      {server.agentVersion && latestAgent?.version && server.agentVersion !== latestAgent.version && server.agentVersion !== 'dev' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Agent update available: <strong>v{latestAgent.version}</strong> (current: v{server.agentVersion}).
          Run on the server: <code style={{ marginLeft: 4, padding: '2px 6px', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.2)' }}>sudo sc-agent update</code>
        </Alert>
      )}

      {/* Offline banner */}
      {(server.status === 'offline' || server.status === 'dead') && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Server is {server.status}
          {server.lastHeartbeat
            ? ` — last heartbeat ${new Date(server.lastHeartbeat).toLocaleString()}`
            : ''}
          . Showing last available historical data.
        </Alert>
      )}

      {/* ============================================================= */}
      {/* Row 1: Server info cards */}
      {/* ============================================================= */}
      <Grid container spacing={1} sx={{ mb: 2 }}>
        {[
          { label: 'OS', value: `${server.osFamily ?? '?'} ${server.osVersion ?? ''}`.trim() },
          { label: 'Kernel', value: server.kernel ?? '-' },
          { label: 'IP', value: server.ipAddresses?.join(', ') ?? '-' },
          { label: 'CPU', value: `${server.cpuCores ?? '?'} cores` },
          { label: 'RAM', value: fmtRam(server.totalRamMb) },
          { label: 'Disk', value: server.totalDiskGb != null ? `${server.totalDiskGb} GB` : '-' },
          { label: 'Uptime', value: fmtUptime(server.lastHeartbeat, server.createdAt) },
          { label: 'Heartbeat', value: server.lastHeartbeat ? new Date(server.lastHeartbeat).toLocaleTimeString() : 'Never' },
        ].map(({ label, value }) => (
          <Grid key={label} size={{ xs: 6, sm: 3, md: 1.5 }}>
            <Card sx={{ bgcolor: 'rgba(15,23,42,0.6)', border: '1px solid', borderColor: 'divider', height: '100%' }}>
              <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {label}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600, mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* ============================================================= */}
      {/* Row 2: Metric gauges */}
      {/* ============================================================= */}
      <Grid container spacing={1.5} mb={2} columns={10}>
        <Grid size={{ xs: 5, sm: 2 }}>
          <Gauge label="CPU Busy" value={latest?.cpu ?? null} thresholds={[60, 85]} />
        </Grid>
        <Grid size={{ xs: 5, sm: 2 }}>
          <Gauge label="Sys Load" value={latest?.loadAvg1 ?? null} max={server.cpuCores ?? 4} unit="" thresholds={[(server.cpuCores ?? 4) * 0.7, (server.cpuCores ?? 4) * 0.9]} />
        </Grid>
        <Grid size={{ xs: 5, sm: 2 }}>
          <Gauge label="RAM Used" value={latest?.memory ?? null} thresholds={[60, 85]} />
        </Grid>
        <Grid size={{ xs: 5, sm: 2 }}>
          <Gauge label="SWAP Used" value={latest?.swapUsedPct ?? null} thresholds={[30, 60]} />
        </Grid>
        <Grid size={{ xs: 5, sm: 2 }}>
          <Gauge label="Disk Used" value={latest?.disk ?? null} thresholds={[75, 90]} />
        </Grid>
      </Grid>

      {/* ============================================================= */}
      {/* Time range picker (Grafana-style) */}
      {/* ============================================================= */}
      <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1} mb={2}>
        <RefreshIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">Auto-refresh 15s</Typography>
        <ToggleButtonGroup
          value={hours}
          exclusive
          onChange={(_, v) => { if (v !== null) setHours(v); }}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              px: 1.5, py: 0.25, fontSize: '0.75rem', textTransform: 'none',
              borderColor: 'divider',
              '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText' },
            },
          }}
        >
          {TIME_RANGES.map((r) => (
            <ToggleButton key={r.hours} value={r.hours}>{r.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {/* ============================================================= */}
      {/* Metric panels — separate rows, Grafana-style */}
      {/* ============================================================= */}

      {/* Row 1: CPU + RAM */}
      <Grid container spacing={1.5} mb={1.5}>
        <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
          <MetricPanel
            title="CPU Usage"
            data={chartRows}
            series={[
              { key: 'cpu', color: '#6366f1', label: 'CPU' },
              { key: 'ioWait', color: '#ef4444', label: 'IOWait' },
            ]}
            hours={hours}
            yDomain={[0, 100]}
            threshold={{ value: 85, color: '#ef4444', label: '85%' }}
            currentValue={latest ? `${Math.round(latest.cpu)}%` : '-'}
            currentColor={cpuColor}
            crosshairTs={crosshairTs}
            onCrosshair={setCrosshairTs}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
          <MetricPanel
            title="Memory Usage"
            data={chartRows}
            series={[
              { key: 'ram', color: '#22d3ee', label: 'RAM' },
              { key: 'swap', color: '#f59e0b', label: 'Swap' },
            ]}
            hours={hours}
            yDomain={[0, 100]}
            threshold={{ value: 85, color: '#ef4444', label: '85%' }}
            currentValue={latest ? `${Math.round(latest.memory)}%` : '-'}
            currentColor={ramColor}
            crosshairTs={crosshairTs}
            onCrosshair={setCrosshairTs}
          />
        </Grid>
      </Grid>

      {/* Row 2: Disk + Load */}
      <Grid container spacing={1.5} mb={1.5}>
        <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
          <MetricPanel
            title="Disk Usage"
            data={chartRows}
            series={[
              { key: 'disk', color: '#f59e0b', label: 'Disk' },
              { key: 'diskIoUtil', color: '#a855f7', label: 'I/O Util' },
            ]}
            hours={hours}
            yDomain={[0, 100]}
            threshold={{ value: 90, color: '#ef4444', label: '90%' }}
            currentValue={latest ? `${Math.round(latest.disk)}%` : '-'}
            currentColor={diskColor}
            crosshairTs={crosshairTs}
            onCrosshair={setCrosshairTs}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
          <MetricPanel
            title="Load Average"
            data={chartRows}
            series={[
              { key: 'load1', color: '#6366f1', label: '1min' },
              { key: 'load5', color: '#22d3ee', label: '5min' },
              { key: 'load15', color: '#a855f7', label: '15min' },
            ]}
            hours={hours}
            unit=""
            yDomain={[0, 'auto']}
            threshold={server.cpuCores ? { value: server.cpuCores, color: '#ef4444', label: `${server.cpuCores} cores` } : undefined}
            currentValue={latest?.loadAvg1 != null ? latest.loadAvg1.toFixed(2) : '-'}
            crosshairTs={crosshairTs}
            onCrosshair={setCrosshairTs}
          />
        </Grid>
      </Grid>

      {/* Row 3: Disk I/O + Network */}
      <Grid container spacing={1.5} mb={1.5}>
        <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
          <MetricPanel
            title="Disk I/O"
            data={chartRows}
            series={[
              { key: 'diskRead', color: '#22d3ee', label: 'Read' },
              { key: 'diskWrite', color: '#f59e0b', label: 'Write' },
            ]}
            hours={hours}
            unit=""
            formatter={fmtBytes}
            yTickFmt={fmtBytesShort}
            currentValue={latest?.diskReadBps != null ? `R ${fmtBytes(latest.diskReadBps)} / W ${fmtBytes(latest.diskWriteBps ?? 0)}` : '-'}
            crosshairTs={crosshairTs}
            onCrosshair={setCrosshairTs}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
          <MetricPanel
            title="Network Throughput"
            data={chartRows}
            series={[
              { key: 'netRx', color: '#6366f1', label: 'RX' },
              { key: 'netTx', color: '#a855f7', label: 'TX' },
            ]}
            hours={hours}
            unit=""
            formatter={fmtBytes}
            yTickFmt={fmtBytesShort}
            currentValue={latest?.netRxBps != null ? `RX ${fmtBytes(latest.netRxBps)} / TX ${fmtBytes(latest.netTxBps ?? 0)}` : '-'}
            crosshairTs={crosshairTs}
            onCrosshair={setCrosshairTs}
          />
        </Grid>
      </Grid>

      {/* ============================================================= */}
      {/* Tabs: Security | Vulnerabilities | Attack Surface | Docker */}
      {/* ============================================================= */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab icon={<SecurityIcon fontSize="small" />} iconPosition="start" label="Security" />
          <Tab label={`Vulnerabilities${vulns?.length ? ` (${vulns.length})` : ''}`} />
          <Tab label="Attack Surface" />
          <Tab icon={<ViewInArIcon fontSize="small" />} iconPosition="start" label="Docker" />
        </Tabs>
      </Box>

      {tab === 0 && <SecurityPostureTab posture={posture ?? null} />}

      {tab === 1 && <VulnerabilitiesTab serverId={server.id} vulns={vulns ?? []} />}

      {tab === 2 && <AttackSurfaceTab serverId={server.id} />}

      {tab === 3 && <DockerTab latest={latest ?? null} />}

      {/* Delete Confirmation Dialog */}
      <DeleteServerDialog
        open={deleteOpen}
        hostname={server.hostname}
        loading={deleteMutation.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          deleteMutation.mutate(server.id, {
            onSuccess: () => navigate('/servers'),
          });
        }}
        copied={copied}
        onCopy={() => {
          navigator.clipboard.writeText(UNINSTALL_CMD);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      />

      {/* Edit Server Dialog */}
      <EditServerDialog
        open={editOpen}
        server={server}
        projects={projects ?? []}
        loading={updateMutation.isPending}
        onClose={() => setEditOpen(false)}
        onSave={(data) => {
          updateMutation.mutate({ id: server.id, ...data }, {
            onSuccess: () => setEditOpen(false),
          });
        }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Edit Server Dialog
// ---------------------------------------------------------------------------

interface EditServerDialogProps {
  open: boolean;
  server: { hostname: string; projectId: string | null; tags: Array<{ key: string; value: string }> };
  projects: Array<{ id: string; name: string }>;
  loading: boolean;
  onClose: () => void;
  onSave: (data: { hostname?: string; projectId?: string | null; tags?: Array<{ key: string; value: string }> }) => void;
}

function EditServerDialog({ open, server, projects, loading, onClose, onSave }: EditServerDialogProps) {
  const [hostname, setHostname] = useState(server.hostname);
  const [projectId, setProjectId] = useState(server.projectId ?? '');
  const [tags, setTags] = useState<Tag[]>(server.tags);

  // Sync when dialog opens with fresh server data.
  const handleEnter = () => {
    setHostname(server.hostname);
    setProjectId(server.projectId ?? '');
    setTags(server.tags);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth TransitionProps={{ onEnter: handleEnter }}>
      <DialogTitle>Edit Server</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            fullWidth size="small"
            label="Hostname"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
          />
          <TextField
            fullWidth size="small" select
            label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <MenuItem value="">No project</MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </TextField>

          <TagsInput tags={tags} onChange={setTags} existingKeys={[]} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          disabled={loading || !hostname.trim()}
          onClick={() => onSave({
            hostname: hostname.trim(),
            projectId: projectId || null,
            tags,
          })}
        >
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete Server Dialog
// ---------------------------------------------------------------------------

const UNINSTALL_CMD = `sudo systemctl stop sc-agent
sudo systemctl disable sc-agent
sudo rm -f /etc/systemd/system/sc-agent.service
sudo systemctl daemon-reload
sudo rm -f /usr/local/bin/sc-agent
sudo rm -rf /etc/securitycentral`;

interface DeleteServerDialogProps {
  open: boolean;
  hostname: string;
  loading: boolean;
  copied: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCopy: () => void;
}

function DeleteServerDialog({ open, hostname, loading, copied, onClose, onConfirm, onCopy }: DeleteServerDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: 'error.main' }}>Delete Server: {hostname}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will permanently delete the server, all metric history, security posture data, and related findings.
          The agent will be instructed to shut down on its next heartbeat.
        </Alert>

        <Typography variant="body2" sx={{ mb: 1.5 }}>
          To fully remove the agent from the server, run these commands via SSH:
        </Typography>

        <Box sx={{
          position: 'relative',
          bgcolor: '#0f172a',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          p: 2,
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          lineHeight: 1.8,
          whiteSpace: 'pre',
          overflow: 'auto',
        }}>
          <IconButton
            size="small"
            onClick={onCopy}
            sx={{ position: 'absolute', top: 4, right: 4 }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          {copied && (
            <Typography variant="caption" sx={{ position: 'absolute', top: 8, right: 40, color: 'success.main' }}>
              Copied
            </Typography>
          )}
          {UNINSTALL_CMD}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <DeleteIcon />}
        >
          {loading ? 'Deleting...' : 'Delete Server'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Docker Tab
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Vulnerabilities Tab (CVE findings from package inventory matching)
// ---------------------------------------------------------------------------

function severityColor(s: string): 'error' | 'warning' | 'info' | 'default' {
  switch (s) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'default';
  }
}

function VulnerabilitiesTab({ serverId, vulns }: { serverId: string; vulns: CveFinding[] }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const { data: inventory } = usePackageInventory(serverId);
  const scanMutation = useTriggerCveScan();
  const hasInventory = !!inventory;

  const filtered = filter === 'all'
    ? vulns
    : filter === 'fix'
      ? vulns.filter((v) => v.detail?.fixedVersion)
      : filter === 'kev'
        ? vulns.filter((v) => v.detail?.cisaKev)
        : vulns.filter((v) => v.severity === filter);

  const critCount = vulns.filter((v) => v.severity === 'critical').length;
  const highCount = vulns.filter((v) => v.severity === 'high').length;
  const medCount = vulns.filter((v) => v.severity === 'medium').length;
  const lowCount = vulns.filter((v) => v.severity === 'low').length;
  const fixAvail = vulns.filter((v) => v.detail?.fixedVersion).length;
  const kevCount = vulns.filter((v) => v.detail?.cisaKev).length;

  const handleFilterChange = (f: string) => {
    setFilter(f);
    setPage(0);
  };

  const scanButton = (
    <Button
      size="small"
      variant="outlined"
      disabled={scanMutation.isPending || !hasInventory}
      onClick={() => scanMutation.mutate(serverId)}
      title={hasInventory ? 'Run CVE scan against latest vulnerability feeds' : 'Waiting for agent to send package inventory'}
    >
      {scanMutation.isPending ? 'Scanning...' : 'Run CVE Scan'}
    </Button>
  );

  if (!hasInventory) {
    return (
      <Typography variant="body2" color="text.secondary">
        Waiting for agent to send package inventory (daily scan).
      </Typography>
    );
  }

  if (vulns.length === 0) {
    return (
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          No vulnerabilities found — {inventory.packages.length} packages scanned {new Date(inventory.collectedAt).toLocaleDateString()}
        </Typography>
        {scanButton}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Header: summary chips + scan button */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`${vulns.length} total`} variant={filter === 'all' ? 'filled' : 'outlined'}
          color={filter === 'all' ? 'primary' : 'default'} onClick={() => handleFilterChange('all')} />
        {critCount > 0 && (
          <Chip label={`${critCount} critical`} color={filter === 'critical' ? 'error' : 'default'}
            variant={filter === 'critical' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('critical')} />
        )}
        {highCount > 0 && (
          <Chip label={`${highCount} high`} color={filter === 'high' ? 'warning' : 'default'}
            variant={filter === 'high' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('high')} />
        )}
        {medCount > 0 && (
          <Chip label={`${medCount} medium`} color={filter === 'medium' ? 'info' : 'default'}
            variant={filter === 'medium' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('medium')} />
        )}
        {lowCount > 0 && (
          <Chip label={`${lowCount} low`} color={filter === 'low' ? 'success' : 'default'}
            variant={filter === 'low' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('low')} />
        )}
        {fixAvail > 0 && (
          <Chip label={`${fixAvail} fix available`} color={filter === 'fix' ? 'primary' : 'default'}
            variant={filter === 'fix' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('fix')} />
        )}
        {kevCount > 0 && (
          <Chip label={`${kevCount} CISA KEV`} color="error"
            variant={filter === 'kev' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('kev')} />
        )}
        </Stack>
        {scanButton}
      </Stack>

      {scanMutation.isSuccess && (
        <Alert severity="success">
          Scan complete: {scanMutation.data.matched} CVEs matched across {scanMutation.data.packages} packages.
          {scanMutation.data.created > 0 ? ` ${scanMutation.data.created} new findings.` : ''}
          {scanMutation.data.resolved > 0 ? ` ${scanMutation.data.resolved} resolved.` : ''}
        </Alert>
      )}
      {scanMutation.isError && (
        <Alert severity="error">{(scanMutation.error as Error).message}</Alert>
      )}

      {/* CVE table */}
      <Card>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>CVE</TableCell>
                  <TableCell>Package</TableCell>
                  <TableCell>Fixed</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>EPSS</TableCell>
                  <TableCell>Fix</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((v) => {
                  const epss = v.detail?.epss;
                  const epssColor = epss != null ? (epss >= 0.5 ? 'error.main' : epss >= 0.1 ? 'warning.main' : 'text.secondary') : undefined;
                  return (
                  <TableRow key={v.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <Stack spacing={0.25}>
                        {v.cveId ? (
                          <a href={v.cveId.startsWith('CVE-')
                            ? `https://nvd.nist.gov/vuln/detail/${v.cveId}`
                            : `https://osv.dev/vulnerability/${v.cveId}`}
                            target="_blank" rel="noopener noreferrer"
                            style={{ color: '#6366f1', textDecoration: 'none' }}>
                            {v.cveId}
                          </a>
                        ) : '-'}
                        <Stack direction="row" spacing={0.5}>
                          {v.detail?.cisaKev && <Chip label="KEV" size="small" color="error" variant="filled" sx={{ fontSize: '0.55rem', height: 16 }} />}
                          {v.cvssScore != null && <Chip label={`CVSS ${v.cvssScore.toFixed(1)}`} size="small" variant="outlined" sx={{ fontSize: '0.55rem', height: 16 }} />}
                        </Stack>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>{v.detail?.packageName ?? '-'}</Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>{v.detail?.installedVersion ?? ''}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      {v.detail?.fixedVersion ? (
                        <Chip label={v.detail.fixedVersion} size="small" color="success" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                      ) : (
                        <Typography variant="caption" color="text.disabled">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={v.severity} size="small" color={severityColor(v.severity)} variant="outlined" sx={{ fontSize: '0.7rem' }} />
                    </TableCell>
                    <TableCell>
                      {epss != null ? (
                        <Tooltip title={`${(epss * 100).toFixed(1)}% chance of exploitation in 30 days (${Math.round((v.detail?.epssPercentile ?? 0) * 100)}th percentile)`} arrow>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600, color: epssColor, cursor: 'help' }}>
                            {(epss * 100).toFixed(1)}%
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.disabled">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.detail?.remediation ? (
                        <Tooltip title={v.detail.remediation} arrow>
                          <Chip label="How to fix" size="small" variant="outlined" color="info"
                            sx={{ fontSize: '0.6rem', height: 20, cursor: 'help' }} />
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.disabled">-</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        No vulnerabilities match the selected filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {filtered.length > 0 && (
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Attack Surface Tab
// ---------------------------------------------------------------------------

function AttackSurfaceTab({ serverId }: { serverId: string }) {
  const { data: scan } = useAttackSurfaceScan(serverId);
  const scanMutation = useTriggerAttackSurfaceScan();

  const isRunning = scan?.status === 'running';
  const openPorts = scan?.openPorts ?? [];
  const adminPanels = scan?.adminPanels ?? [];
  const summary = scan?.summary;

  return (
    <Stack spacing={1.5}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {scan?.completedAt
            ? `Last scan: ${new Date(scan.completedAt).toLocaleString()} — ${scan.targetIp}`
            : 'No scan yet'}
        </Typography>
        <Button
          size="small" variant="outlined"
          disabled={scanMutation.isPending || isRunning}
          onClick={() => scanMutation.mutate(serverId)}
        >
          {isRunning ? 'Scanning...' : 'Run Scan'}
        </Button>
      </Stack>

      {scanMutation.isError && (
        <Alert severity="error" sx={{ py: 0.5 }}>{(scanMutation.error as Error).message}</Alert>
      )}

      {/* Summary chips */}
      {summary && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`${summary.totalOpen} open ports`} variant="outlined" />
          {summary.critical > 0 && <Chip size="small" label={`${summary.critical} critical`} color="error" variant="outlined" />}
          {summary.high > 0 && <Chip size="small" label={`${summary.high} high`} color="warning" variant="outlined" />}
          {summary.adminPanels > 0 && <Chip size="small" label={`${summary.adminPanels} admin panels`} color="error" variant="outlined" />}
        </Stack>
      )}

      {/* Open ports table */}
      {openPorts.length > 0 && (
        <Card>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Port</TableCell>
                    <TableCell>Service</TableCell>
                    <TableCell>Version</TableCell>
                    <TableCell>Risk</TableCell>
                    <TableCell>Response</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {openPorts.map((p) => (
                    <TableRow key={p.port}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{p.port}</TableCell>
                      <TableCell>
                        {p.service}
                        {p.isDatabase && <Chip label="DB" size="small" color="error" variant="outlined" sx={{ ml: 0.5, fontSize: '0.6rem', height: 16 }} />}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{p.version ?? '-'}</TableCell>
                      <TableCell>
                        <Chip label={p.riskLevel} size="small" variant="outlined"
                          color={p.riskLevel === 'critical' ? 'error' : p.riskLevel === 'high' ? 'warning' : p.riskLevel === 'medium' ? 'info' : 'default'} />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{p.responseMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Admin panels */}
      {adminPanels.length > 0 && (
        <Card>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'error.main' }}>Exposed Admin Panels</Typography>
            {adminPanels.map((p, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  :{p.port}{p.path}
                </Typography>
                <Chip label={`HTTP ${p.status}`} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 16 }} />
              </Stack>
            ))}
          </CardContent>
        </Card>
      )}

      {!scan && !scanMutation.isPending && (
        <Typography variant="body2" color="text.secondary">
          Run an attack surface scan to discover what's externally reachable on this server.
        </Typography>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Docker Tab
// ---------------------------------------------------------------------------

function DockerTab({ latest }: { latest: { docker: ServerMetric['docker'] } | null }) {
  const docker = latest?.docker;

  if (!docker) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            No Docker data available. Docker may not be installed on this server, or the agent hasn't sent a heartbeat yet.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1}>
        <Chip label={`${docker.running} running`} color="success" variant="outlined" />
        <Chip label={`${docker.stopped} stopped`} color={docker.stopped > 0 ? 'warning' : 'default'} variant="outlined" />
        <Chip label={`${docker.containers.length} total`} variant="outlined" />
      </Stack>

      <Card>
        <CardContent>
          <Typography variant="h6" mb={1}>Containers</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Image</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell align="right">CPU %</TableCell>
                  <TableCell align="right">Mem %</TableCell>
                  <TableCell align="right">Restarts</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {docker.containers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.name}</TableCell>
                    <TableCell sx={{ fontSize: '0.8rem' }}>{c.image}</TableCell>
                    <TableCell>
                      <Chip label={c.state} size="small"
                        color={c.state === 'running' ? 'success' : c.state === 'restarting' ? 'warning' : 'default'}
                        variant="outlined" />
                    </TableCell>
                    <TableCell align="right">{c.cpu.toFixed(1)}%</TableCell>
                    <TableCell align="right">{c.memory.toFixed(1)}%</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color={c.restarts > 0 ? 'warning.main' : 'text.primary'}>
                        {c.restarts}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {docker.containers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">No containers found</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Security Posture Tab
// ---------------------------------------------------------------------------

function StatusIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircleIcon fontSize="small" color="success" />
    : <CancelIcon fontSize="small" color="error" />;
}

// ---------------------------------------------------------------------------
// Hardening Audit Results
// ---------------------------------------------------------------------------

interface AuditItem {
  id: string;
  category: string;
  title: string;
  status: 'pass' | 'fail' | 'warn';
  severity: string;
  detail: string;
}

function AuditResultsSection({ results }: { results: AuditItem[] }) {
  const categories = [...new Set(results.map((r) => r.category))];
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail').length;
  const total = results.length;
  const passPercent = total > 0 ? Math.round((passCount / total) * 100) : 0;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">Hardening Audit</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={`${passCount}/${total} passed`}
              color={failCount === 0 ? 'success' : failCount <= 3 ? 'warning' : 'error'}
              size="small" />
            <Box sx={{ width: 120, height: 6, bgcolor: 'action.hover', borderRadius: 3, overflow: 'hidden' }}>
              <Box sx={{ width: `${passPercent}%`, height: '100%', bgcolor: failCount === 0 ? 'success.main' : 'warning.main', borderRadius: 3 }} />
            </Box>
          </Stack>
        </Stack>

        {categories.map((cat) => {
          const items = results.filter((r) => r.category === cat);
          return (
            <Box key={cat} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>{cat}</Typography>
              {items.map((item) => (
                <Stack key={item.id} direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.5, pl: 1, borderLeft: '2px solid', borderColor: item.status === 'pass' ? 'success.main' : item.status === 'fail' ? 'error.main' : 'warning.main', mb: 0.5 }}>
                  {item.status === 'pass' ? <CheckCircleIcon fontSize="small" color="success" sx={{ mt: 0.2 }} /> :
                   item.status === 'fail' ? <CancelIcon fontSize="small" color="error" sx={{ mt: 0.2 }} /> :
                   <WarningIcon fontSize="small" color="warning" sx={{ mt: 0.2 }} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{item.title}</Typography>
                      {item.status === 'fail' && (
                        <Chip label={item.severity} size="small" color={item.severity === 'critical' ? 'error' : item.severity === 'high' ? 'warning' : 'default'} variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                      {item.detail}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Box>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SecurityPostureTab({ posture }: { posture: SecurityPosture | null }) {
  const [showPorts, setShowPorts] = useState(false);

  if (!posture) {
    return (
      <Typography variant="body2" color="text.secondary">
        No security posture data yet. The agent scans every hour.
      </Typography>
    );
  }

  const sshOk = posture.sshConfig.rootLogin !== 'yes' && posture.sshConfig.passwordAuth !== 'yes';
  const fwOk = posture.firewallActive;
  const auditResults = posture.auditResults ?? [];
  const auditFail = auditResults.filter((r) => r.status === 'fail');
  const auditWarn = auditResults.filter((r) => r.status === 'warn');
  const auditPass = auditResults.filter((r) => r.status === 'pass');
  // Ports truly exposed to the internet (bound publicly AND firewall allows or has no restrictions).
  const internetPorts = posture.listeningPorts.filter((p) => p.exposure === 'internet');
  const restrictedPorts = posture.listeningPorts.filter((p) => p.exposure === 'restricted');
  // Fallback for older agents that don't report exposure: use bind as before.
  const publicPorts = posture.listeningPorts.some((p) => p.exposure)
    ? internetPorts
    : posture.listeningPorts.filter((p) => p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '');

  return (
    <Stack spacing={1.5}>
      {/* Quick status chips */}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {(() => {
          const fwIssues = posture.firewallDetail?.issues ?? [];
          const hasIssues = fwIssues.length > 0;
          const color = !fwOk ? 'error' : hasIssues ? 'warning' : 'success';
          const label = !fwOk
            ? 'No firewall'
            : hasIssues
              ? `Firewall (${posture.firewallType}) — misconfigured`
              : `Firewall (${posture.firewallType})`;
          const icon = !fwOk
            ? <CancelIcon />
            : hasIssues
              ? <WarningIcon />
              : <CheckCircleIcon />;
          const tooltipContent = !fwOk
            ? 'CRITICAL: No firewall detected. Server is directly exposed to the internet. Enable ufw, nftables, or iptables immediately.'
            : hasIssues
              ? `${posture.firewallType} is active but has ${fwIssues.length} configuration issue${fwIssues.length > 1 ? 's' : ''}:\n\n${fwIssues.map((i) => '• ' + i).join('\n')}`
              : `${posture.firewallType} firewall is active and blocking unauthorized traffic.${posture.firewallDetail?.defaultPolicy ? `\n\nDefault input policy: ${posture.firewallDetail.defaultPolicy}` : ''}`;
          return (
            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>} arrow>
              <Chip size="small" icon={icon} label={label} color={color} variant="outlined" />
            </Tooltip>
          );
        })()}
        <Tooltip title={sshOk
          ? 'SSH is hardened: root login disabled and password authentication disabled (key-based auth only).'
          : 'CRITICAL: SSH allows root login or password authentication. Attackers can brute force. Edit /etc/ssh/sshd_config: set PermitRootLogin no and PasswordAuthentication no.'} arrow>
          <Chip size="small" icon={sshOk ? <CheckCircleIcon /> : <CancelIcon />}
            label={sshOk ? 'SSH hardened' : 'SSH weak'}
            color={sshOk ? 'success' : 'error'} variant="outlined" />
        </Tooltip>
        {posture.pendingReboot && (
          <Tooltip title="Kernel or system packages were updated but the new versions are not yet active. Reboot when convenient to apply patches. Not urgent, but don't leave indefinitely." arrow>
            <Chip size="small" icon={<WarningIcon />} label="Reboot pending" color="warning" variant="outlined" />
          </Tooltip>
        )}
        {posture.sshFailures > 0 && (
          <Tooltip title={posture.sshFailures > 10
            ? `CRITICAL: ${posture.sshFailures} failed SSH login attempts detected. This indicates an active brute-force attack. Consider blocking attacker IPs via fail2ban or firewall.`
            : `${posture.sshFailures} failed SSH login attempts detected. Monitor and block the source IPs if the count grows.`} arrow>
            <Chip size="small" label={`${posture.sshFailures} SSH fail attempts`}
              color={posture.sshFailures > 10 ? 'error' : 'warning'} variant="outlined" />
          </Tooltip>
        )}
        <Tooltip title={
          restrictedPorts.length > 0
            ? `${publicPorts.length} port${publicPorts.length === 1 ? '' : 's'} reachable from the internet. ${restrictedPorts.length} more allow only specific source IPs (safe).`
            : `${publicPorts.length} port${publicPorts.length === 1 ? '' : 's'} reachable from the internet.`
        } arrow>
          <Chip size="small" label={`${publicPorts.length} exposed ports${restrictedPorts.length > 0 ? ` (+${restrictedPorts.length} restricted)` : ''}`}
            color={publicPorts.length > 5 ? 'warning' : 'default'} variant="outlined"
            onClick={() => setShowPorts(!showPorts)} sx={{ cursor: 'pointer' }} />
        </Tooltip>
        <Chip size="small" label={`${posture.shellUsers.length} shell users (${posture.shellUsers.join(', ')})`} variant="outlined" />
        {posture.loggedInUsers.length > 0 && (
          <Chip size="small" label={`${posture.loggedInUsers.length} active session${posture.loggedInUsers.length > 1 ? 's' : ''}`} variant="outlined" />
        )}
        {auditResults.length > 0 && (
          <Chip size="small"
            label={`Audit: ${auditPass.length} pass / ${auditFail.length} fail`}
            color={auditFail.length === 0 ? 'success' : auditFail.length <= 3 ? 'warning' : 'error'}
            variant="outlined" />
        )}
        {posture.cisSummary && posture.cisSummary.mapped > 0 && (
          <Chip size="small"
            label={`CIS: ${posture.cisSummary.passing}/${posture.cisSummary.mapped} controls`}
            color={posture.cisSummary.failing === 0 ? 'success' : 'warning'}
            variant="outlined" />
        )}
      </Stack>

      {/* Expanded listening ports (toggle) */}
      {showPorts && (
        <Card sx={{ bgcolor: 'rgba(15,23,42,0.5)' }}>
          <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              <strong>Red</strong> = exposed to the internet (bound publicly, firewall allows anywhere).
              <strong> Green</strong> = restricted (firewall allows only specific IPs).
              <strong> Blue</strong> = blocked (firewall drops traffic despite public bind).
              <strong> Grey</strong> = localhost only.
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {posture.listeningPorts.map((p, i) => {
                const bindLabel = p.bind || '0.0.0.0';
                const exposure = p.exposure ?? (p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '' ? 'internet' : 'localhost');
                let color: 'error' | 'success' | 'info' | 'default' = 'default';
                let tooltip = '';
                switch (exposure) {
                  case 'internet':
                    color = 'error';
                    tooltip = `EXPOSED: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is reachable from the internet. No firewall restriction.`;
                    break;
                  case 'restricted':
                    color = 'success';
                    tooltip = `RESTRICTED: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is bound publicly but firewall allows only: ${(p.allowedFrom ?? []).join(', ')}`;
                    break;
                  case 'blocked':
                    color = 'info';
                    tooltip = `BLOCKED: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is bound publicly but firewall default policy blocks all inbound traffic to it.`;
                    break;
                  case 'localhost':
                    color = 'default';
                    tooltip = `LOCAL: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is only accessible from the same machine.`;
                    break;
                  default:
                    tooltip = `${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto}. Exposure unknown (agent may be old or firewall unreadable).`;
                }
                return (
                  <Tooltip key={i} title={tooltip} arrow>
                    <Chip size="small" variant="outlined"
                      label={`${bindLabel}:${p.port}/${p.proto} ${p.process || ''}`}
                      color={color}
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }} />
                  </Tooltip>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Issues only — failed and warning audit checks */}
      {auditFail.length + auditWarn.length > 0 && (
        <Card>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>Issues Found</Typography>
            {[...auditFail, ...auditWarn].map((item) => (
              <Stack key={item.id} direction="row" spacing={1} alignItems="center"
                sx={{ py: 0.5, borderLeft: '2px solid', borderColor: item.status === 'fail' ? 'error.main' : 'warning.main', pl: 1, mb: 0.5 }}>
                {item.status === 'fail'
                  ? <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  : <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
                <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>{item.title}</Typography>
                {item.cis && (
                  <Chip label={`${item.cis.benchmark} ${item.cis.controlId}`} size="small" variant="outlined"
                    sx={{ fontSize: '0.55rem', height: 18, borderColor: 'info.main', color: 'info.main' }} />
                )}
                <Chip label={item.severity} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }}
                  color={item.severity === 'critical' ? 'error' : item.severity === 'high' ? 'warning' : 'default'} />
              </Stack>
            ))}
          </CardContent>
        </Card>
      )}

      {/* SSH details — only if there are problems */}
      {!sshOk && (
        <Card sx={{ bgcolor: 'rgba(15,23,42,0.5)' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, color: 'text.secondary' }}>SSH Configuration</Typography>
            <Stack spacing={0.5}>
              {posture.sshConfig.rootLogin === 'yes' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  <Typography variant="body2" fontSize="0.8rem">Root login enabled</Typography>
                </Stack>
              )}
              {posture.sshConfig.passwordAuth === 'yes' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  <Typography variant="body2" fontSize="0.8rem">Password auth enabled (use key-based)</Typography>
                </Stack>
              )}
              {posture.sshConfig.permitEmptyPwd === 'yes' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  <Typography variant="body2" fontSize="0.8rem">Empty passwords permitted</Typography>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Brute force activity */}
      {posture.bruteForce && (posture.bruteForce.sshVelocity > 0 || posture.bruteForce.httpVelocity > 0) && (() => {
        const bf = posture.bruteForce!;
        return (
          <Card sx={{ bgcolor: bf.isActiveAttack || bf.hasCompromise ? 'rgba(239,68,68,0.08)' : 'rgba(15,23,42,0.5)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <Typography variant="subtitle2" sx={{ color: bf.isActiveAttack ? 'error.main' : 'text.secondary' }}>
                  {bf.isActiveAttack ? 'Active Attack Detected' : 'Brute Force Activity'}
                </Typography>
                {bf.isActiveAttack && <Chip label="ACTIVE" size="small" color="error" variant="filled" sx={{ fontSize: '0.6rem', height: 18 }} />}
                {bf.isDistributed && <Chip label="DISTRIBUTED" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
              </Stack>

              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                {bf.sshVelocity > 0 && (
                  <Typography variant="body2" fontSize="0.8rem">
                    SSH: <strong>{bf.sshVelocity}</strong> failures/5min from <strong>{bf.sshUniqueIps}</strong> IPs
                  </Typography>
                )}
                {bf.httpVelocity > 0 && (
                  <Typography variant="body2" fontSize="0.8rem">
                    HTTP: <strong>{bf.httpVelocity}</strong> 401/403s/5min from <strong>{bf.httpUniqueIps}</strong> IPs
                  </Typography>
                )}
              </Stack>

              {bf.sshTopAttackers && bf.sshTopAttackers.length > 0 && (
                <Stack direction="row" spacing={0.5} mt={0.75} flexWrap="wrap" useFlexGap>
                  {bf.sshTopAttackers.map((a) => (
                    <Chip key={a.ip} label={`${a.ip} (${a.count}x)`} size="small" variant="outlined"
                      sx={{ fontFamily: 'monospace', fontSize: '0.65rem' }} />
                  ))}
                </Stack>
              )}

              {bf.hasCompromise && bf.sshCompromise?.map((c, i) => (
                <Alert key={i} severity="error" sx={{ mt: 1, py: 0.5 }}>
                  <strong>Potential compromise:</strong> {c.ip} failed {c.failuresBefore}x then logged in as "{c.successUser}"
                </Alert>
              ))}
            </CardContent>
          </Card>
        );
      })()}

      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
        Last scan: {new Date(posture.collectedAt).toLocaleString()}
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Info row helper
// ---------------------------------------------------------------------------

function InfoRow({ icon, label, value, mono }: { icon?: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        {icon}
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </Stack>
      <Typography variant="body2" sx={{
        fontWeight: 500,
        fontFamily: mono ? 'monospace' : undefined,
        fontSize: mono ? '0.8rem' : undefined,
      }}>
        {value || '-'}
      </Typography>
    </Box>
  );
}
