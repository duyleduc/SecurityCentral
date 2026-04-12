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
import { useServer, useServerMetrics, useSecurityPosture, useDeleteServer, useUpdateServer, useProjects } from '../../api/hooks';
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
  const { data: server, isLoading } = useServer(id ?? '');
  const { data: metrics } = useServerMetrics(id ?? '', hours);
  const { data: posture } = useSecurityPosture(id ?? '');
  const { data: projects } = useProjects();
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
            variant="outlined"
            size="small"
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </Stack>
      </Stack>

      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <ScoreBadge score={computeScore({}).score} breakdown={computeScore({}).breakdown} size="medium" />
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h4">{server.hostname}</Typography>
            <Chip
              label={server.status}
              color={server.status === 'online' ? 'success' : server.status === 'critical' ? 'error' : server.status === 'warning' ? 'warning' : 'default'}
            />
            {server.project && (
              <Chip icon={<FolderIcon sx={{ fontSize: 14 }} />} label={server.project.name} size="small" variant="outlined"
                onClick={() => navigate(`/projects/${server.project!.id}`)} />
            )}
            {server.agentVersion && <Chip label={`Agent v${server.agentVersion}`} variant="outlined" size="small" />}
          </Stack>
          {server.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              {server.tags.map((t) => (
                <Chip key={t.key} label={t.value ? `${t.key}:${t.value}` : t.key} size="small"
                  sx={{ fontSize: '0.65rem', bgcolor: 'action.selected' }} />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>

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
      {/* Tabs: System Info | Security Posture | Docker */}
      {/* ============================================================= */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, mt: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="System Information" />
          <Tab icon={<SecurityIcon fontSize="small" />} iconPosition="start" label="Security Posture" />
          <Tab icon={<ViewInArIcon fontSize="small" />} iconPosition="start" label="Docker" />
        </Tabs>
      </Box>

      {tab === 0 && (
        <Card>
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <InfoRow icon={<StorageIcon fontSize="small" />} label="Hostname" value={server.hostname} />
                <InfoRow label="OS" value={`${server.osFamily ?? 'Unknown'} ${server.osVersion ?? ''}`} />
                <InfoRow label="Kernel" value={server.kernel ?? '-'} />
                <InfoRow label="Architecture" value={(server as any).arch ?? '-'} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <InfoRow icon={<MemoryIcon fontSize="small" />} label="CPU" value={server.cpuModel ?? '-'} />
                <InfoRow label="CPU Cores" value={server.cpuCores != null ? String(server.cpuCores) : '-'} />
                <InfoRow label="Total RAM" value={server.totalRamMb != null ? (server.totalRamMb >= 1024 ? `${(server.totalRamMb / 1024).toFixed(1)} GB` : `${server.totalRamMb} MB`) : '-'} />
                <InfoRow label="Total Disk" value={server.totalDiskGb != null ? `${server.totalDiskGb} GB` : '-'} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <InfoRow icon={<DnsIcon fontSize="small" />} label="IP Addresses" value={server.ipAddresses?.join(', ') ?? '-'} />
                <InfoRow label="Agent ID" value={server.agentId ?? '-'} mono />
                <InfoRow label="Agent Version" value={server.agentVersion ?? '-'} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <InfoRow label="Last Heartbeat" value={server.lastHeartbeat ? new Date(server.lastHeartbeat).toLocaleString() : 'Never'} />
                <InfoRow label="Registered" value={new Date(server.createdAt).toLocaleString()} />
                <InfoRow label="Status" value={server.status} />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {tab === 1 && <SecurityPostureTab posture={posture ?? null} />}

      {tab === 2 && <DockerTab latest={latest ?? null} />}

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
  server: { projectId: string | null; tags: Array<{ key: string; value: string }> };
  projects: Array<{ id: string; name: string }>;
  loading: boolean;
  onClose: () => void;
  onSave: (data: { projectId?: string | null; tags?: Array<{ key: string; value: string }> }) => void;
}

function EditServerDialog({ open, server, projects, loading, onClose, onSave }: EditServerDialogProps) {
  const [projectId, setProjectId] = useState(server.projectId ?? '');
  const [tags, setTags] = useState<Tag[]>(server.tags);

  // Sync when dialog opens with fresh server data.
  const handleEnter = () => {
    setProjectId(server.projectId ?? '');
    setTags(server.tags);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth TransitionProps={{ onEnter: handleEnter }}>
      <DialogTitle>Edit Server</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
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
          disabled={loading}
          onClick={() => onSave({
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

const UNINSTALL_CMD = `sudo systemctl stop securitycentral-agent
sudo systemctl disable securitycentral-agent
sudo rm -f /etc/systemd/system/securitycentral-agent.service
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

function SecurityPostureTab({ posture }: { posture: SecurityPosture | null }) {
  if (!posture) {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            No security posture data yet. The agent performs a security scan every hour.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const sshOk = posture.sshConfig.rootLogin !== 'yes' && posture.sshConfig.passwordAuth !== 'yes';
  const fwOk = posture.firewallActive;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip icon={fwOk ? <CheckCircleIcon /> : <WarningIcon />} label={`Firewall: ${posture.firewallType}${fwOk ? ' active' : ' inactive'}`}
          color={fwOk ? 'success' : 'warning'} variant="outlined" />
        <Chip icon={sshOk ? <CheckCircleIcon /> : <WarningIcon />} label={sshOk ? 'SSH hardened' : 'SSH needs hardening'}
          color={sshOk ? 'success' : 'warning'} variant="outlined" />
        {posture.pendingReboot && <Chip icon={<WarningIcon />} label="Reboot pending" color="warning" variant="outlined" />}
        {posture.sshFailures > 0 && <Chip icon={<WarningIcon />} label={`${posture.sshFailures} SSH failures`}
          color={posture.sshFailures > 10 ? 'error' : 'warning'} variant="outlined" />}
        <Chip label={`${posture.listeningPorts.length} listening ports`} variant="outlined" />
        <Chip label={`${posture.shellUsers.length} shell users`} variant="outlined" />
        {posture.openFdAlloc != null && posture.openFdMax != null && (
          <Chip label={`FDs: ${posture.openFdAlloc.toLocaleString()} / ${posture.openFdMax.toLocaleString()}`} variant="outlined" />
        )}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={1}>SSH Configuration</Typography>
              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StatusIcon ok={posture.sshConfig.rootLogin !== 'yes'} />
                  <Typography variant="body2">Root Login: <strong>{posture.sshConfig.rootLogin}</strong></Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StatusIcon ok={posture.sshConfig.passwordAuth !== 'yes'} />
                  <Typography variant="body2">Password Auth: <strong>{posture.sshConfig.passwordAuth}</strong></Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StatusIcon ok={posture.sshConfig.permitEmptyPwd !== 'yes'} />
                  <Typography variant="body2">Empty Passwords: <strong>{posture.sshConfig.permitEmptyPwd}</strong></Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">Port: {posture.sshConfig.port}</Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={1}>Active Sessions</Typography>
              {posture.loggedInUsers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No active sessions</Typography>
              ) : (
                <Stack spacing={0.5}>
                  {posture.loggedInUsers.map((u, i) => (
                    <Typography key={i} variant="body2">
                      <strong>{u.user}</strong> from {u.from} since {u.since}
                    </Typography>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" mb={1}>Listening Ports</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Port</TableCell>
                  <TableCell>Proto</TableCell>
                  <TableCell>Process</TableCell>
                  <TableCell>Bind</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {posture.listeningPorts.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{p.port}</TableCell>
                    <TableCell>{p.proto}</TableCell>
                    <TableCell>{p.process || '-'}</TableCell>
                    <TableCell>
                      <Chip label={p.bind || '0.0.0.0'} size="small"
                        color={p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '' ? 'warning' : 'default'}
                        variant="outlined" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" mb={1}>Shell Users</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {posture.shellUsers.map((u) => (
              <Chip key={u} label={u} size="small" variant="outlined"
                color={u === 'root' ? 'warning' : 'default'}
                sx={{ fontFamily: 'monospace' }} />
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.secondary">
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
