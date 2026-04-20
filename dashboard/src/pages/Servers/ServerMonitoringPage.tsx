import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Stack,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
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
import { useServer, useServerMetrics, type ServerMetric } from '../../api/hooks';
import { ServerHeader } from './ServerHeader';
import { classifyOs } from './osEol';

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

/**
 * Server-side uptime (not agent uptime): time elapsed since the host booted.
 * Falls back to agent-reporting window if boot time is unavailable.
 */
function fmtServerUptime(bootTime: string | null, lastHeartbeat: string | null, createdAt: string): string {
  const reference = lastHeartbeat ? new Date(lastHeartbeat).getTime() : Date.now();
  const origin = bootTime ? new Date(bootTime).getTime() : new Date(createdAt).getTime();
  const ms = reference - origin;
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

interface GaugeProps {
  label: string;
  value: number | null;
  max?: number;
  unit?: string;
  display?: string;
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

  const warnFrac = thresholds[0] / max;
  const critFrac = thresholds[1] / max;

  const normVal = value ?? 0;
  const valColor = normVal >= thresholds[1] ? '#ef4444'
    : normVal >= thresholds[0] ? '#f59e0b'
    : '#22c55e';

  const needlePt = pointAt(pct);
  const displayText = display ?? (hasValue ? `${value % 1 === 0 ? value : value.toFixed(1)}${unit}` : '-');

  return (
    <Card sx={{
      bgcolor: 'rgba(15,23,42,0.7)', border: '1px solid', borderColor: 'divider',
      textAlign: 'center', px: 0.5, pt: 0, pb: 0.5, minWidth: 0, overflow: 'hidden',
    }}>
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.65rem', display: 'block', pt: 0.75, pb: 0 }}>
        {label}
      </Typography>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', margin: '0 auto' }}>
        <path d={arcBetween(0, warnFrac)} fill="none" stroke="rgba(34,197,94,0.2)" strokeWidth={strokeW} strokeLinecap="butt" />
        <path d={arcBetween(warnFrac, critFrac)} fill="none" stroke="rgba(245,158,11,0.2)" strokeWidth={strokeW} strokeLinecap="butt" />
        <path d={arcBetween(critFrac, 1)} fill="none" stroke="rgba(239,68,68,0.2)" strokeWidth={strokeW} strokeLinecap="butt" />

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

        {hasValue && pct > 0.005 && (
          <>
            <circle cx={pointAt(0).x} cy={pointAt(0).y} r={strokeW / 2} fill="#22c55e" />
            <circle cx={needlePt.x} cy={needlePt.y} r={strokeW / 2} fill={valColor} />
          </>
        )}

        {hasValue && (
          <circle cx={needlePt.x} cy={needlePt.y} r={strokeW / 2 + 2} fill={valColor} opacity={0.9} />
        )}

        <text x={cx} y={cy + 6} textAnchor="middle" fill={hasValue ? '#e2e8f0' : 'rgba(255,255,255,0.3)'}
          fontSize="20" fontWeight="700" fontFamily="monospace">
          {displayText}
        </text>

        <text x={pointAt(0).x} y={pointAt(0).y + 14} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">0</text>
        <text x={pointAt(1).x} y={pointAt(1).y + 14} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">{max}</text>
      </svg>
    </Card>
  );
}

interface PanelTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  unit?: string;
  formatter?: (v: number) => string;
}

function PanelTooltip({ active, payload, label, unit = '', formatter }: PanelTooltipProps) {
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
  crosshairTs?: number | null;
  onCrosshair?: (ts: number | null) => void;
}

interface SeriesStats {
  key: string;
  label: string;
  color: string;
  current: number;
  min: number;
  max: number;
  avg: number;
}

function computeStats(
  data: Array<Record<string, unknown>>,
  series: Array<{ key: string; color: string; label?: string }>,
): SeriesStats[] {
  return series.map((s) => {
    let min = Infinity, max = -Infinity, sum = 0, count = 0, current = 0;
    for (const row of data) {
      const raw = row[s.key];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      if (raw < min) min = raw;
      if (raw > max) max = raw;
      sum += raw;
      count++;
      current = raw;
    }
    return {
      key: s.key,
      label: s.label ?? s.key,
      color: s.color,
      current: count > 0 ? current : 0,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      avg: count > 0 ? sum / count : 0,
    };
  });
}

function MetricPanel({
  title, data, series, hours, unit = '%', yDomain, formatter, yTickFmt,
  threshold, height = 200, currentValue, currentColor, crosshairTs, onCrosshair,
}: MetricPanelProps) {
  const theme = useTheme();
  const empty = data.length === 0;
  const stats = useMemo(() => computeStats(data, series), [data, series]);
  const fmtVal = formatter ?? ((v: number) => `${v.toFixed(1)}${unit}`);

  return (
    <Card sx={{
      bgcolor: alpha(theme.palette.background.paper, 0.6),
      border: '1px solid',
      borderColor: 'divider',
      overflow: 'hidden',
    }}>
      <CardContent sx={{ pb: '12px !important', pt: 1.5, px: 2 }}>
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
                onMouseMove={(state) => {
                  const ts = state?.activeLabel;
                  if (typeof ts === 'number') onCrosshair?.(ts);
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
                  content={<PanelTooltip unit={unit} formatter={formatter} />}
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

        {!empty && stats.length > 0 && (
          <Box sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider', pt: 0.75 }}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {stats.map((s) => (
                <Stack key={s.key} direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', minWidth: 40 }}>
                    {s.label}
                  </Typography>
                  <Stack direction="row" spacing={0.75} sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                    <StatChip label="min" value={fmtVal(s.min)} />
                    <StatChip label="max" value={fmtVal(s.max)} />
                    <StatChip label="avg" value={fmtVal(s.avg)} />
                    <StatChip label="cur" value={fmtVal(s.current)} highlight />
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Stack direction="row" spacing={0.25} alignItems="baseline">
      <Typography component="span" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
        {label}
      </Typography>
      <Typography component="span" sx={{
        fontFamily: 'monospace',
        fontSize: '0.7rem',
        fontWeight: highlight ? 700 : 500,
        color: highlight ? 'text.primary' : 'text.secondary',
      }}>
        {value}
      </Typography>
    </Stack>
  );
}

export function ServerMonitoringPage() {
  const { id } = useParams<{ id: string }>();
  const [hours, setHours] = useState(24);
  const [crosshairTs, setCrosshairTs] = useState<number | null>(null);
  const { data: server, isLoading } = useServer(id ?? '');
  const { data: metrics } = useServerMetrics(id ?? '', hours);

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

  const osInfo = useMemo(() => classifyOs(server?.osFamily, server?.osVersion), [server?.osFamily, server?.osVersion]);
  const uptimeTooltip = server?.bootTime
    ? `Server booted at ${new Date(server.bootTime).toLocaleString()}.`
    : 'Boot time not yet reported by the agent — showing time since agent first heartbeat.';

  if (isLoading) return <CircularProgress />;
  if (!server) return <Typography>Server not found</Typography>;

  const infoCards: Array<{
    label: string;
    value: string;
    tooltip?: string;
    valueColor?: string;
  }> = [
    {
      label: 'OS',
      value: `${server.osFamily ?? '?'} ${server.osVersion ?? ''}`.trim(),
      tooltip: osInfo.message || undefined,
      valueColor:
        osInfo.status === 'eol' ? 'error.main'
          : osInfo.status === 'eol_soon' ? 'warning.main'
          : osInfo.status === 'upgrade_available' ? 'warning.main'
          : undefined,
    },
    { label: 'Kernel', value: server.kernel ?? '-', tooltip: server.kernel ?? undefined },
    { label: 'IP', value: server.ipAddresses?.join(', ') ?? '-' },
    { label: 'CPU', value: `${server.cpuCores ?? '?'} cores` },
    { label: 'RAM', value: fmtRam(server.totalRamMb) },
    { label: 'Disk', value: server.totalDiskGb != null ? `${server.totalDiskGb} GB` : '-' },
    {
      label: 'Uptime',
      value: fmtServerUptime(server.bootTime, server.lastHeartbeat, server.createdAt),
      tooltip: uptimeTooltip,
    },
    {
      label: 'Heartbeat',
      value: server.lastHeartbeat ? new Date(server.lastHeartbeat).toLocaleTimeString() : 'Never',
      tooltip: server.lastHeartbeat ? new Date(server.lastHeartbeat).toLocaleString() : undefined,
    },
  ];

  return (
    <Box>
      <ServerHeader server={server} activeTab="monitoring" />

      <Grid container spacing={1} sx={{ mb: 2 }}>
        {infoCards.map(({ label, value, tooltip, valueColor }) => {
          const card = (
            <Card sx={{ bgcolor: 'rgba(15,23,42,0.6)', border: '1px solid', borderColor: 'divider', height: '100%' }}>
              <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {label}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600, mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: valueColor ?? 'text.primary' }}>
                  {value}
                </Typography>
              </CardContent>
            </Card>
          );
          return (
            <Grid key={label} size={{ xs: 6, sm: 3, md: 1.5 }}>
              {tooltip ? <Tooltip title={tooltip} arrow placement="top">{card}</Tooltip> : card}
            </Grid>
          );
        })}
      </Grid>

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

      <DockerSection latest={latest ?? null} />
    </Box>
  );
}

function DockerSection({ latest }: { latest: { docker: ServerMetric['docker'] } | null }) {
  const docker = latest?.docker;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" sx={{ mb: 1.5 }}>Docker</Typography>
      {!docker ? (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              No Docker data available. Docker may not be installed on this server, or the agent hasn't sent a heartbeat yet.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <Chip label={`${docker.running} running`} color="success" variant="outlined" />
            <Chip label={`${docker.stopped} stopped`} color={docker.stopped > 0 ? 'warning' : 'default'} variant="outlined" />
            <Chip label={`${docker.containers.length} total`} variant="outlined" />
          </Stack>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" mb={1}>Containers</Typography>
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
      )}
    </Box>
  );
}
