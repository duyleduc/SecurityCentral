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
  Divider,
  Paper,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import StorageIcon from '@mui/icons-material/Storage';
import MemoryIcon from '@mui/icons-material/Memory';
import DnsIcon from '@mui/icons-material/Dns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { useServer, useServerMetrics } from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: server, isLoading } = useServer(id ?? '');
  const { data: metrics } = useServerMetrics(id ?? '', 24);

  if (isLoading) return <CircularProgress />;
  if (!server) return <Typography>Server not found</Typography>;

  const chartData = metrics?.map((m) => ({
    time: formatTime(m.createdAt),
    CPU: Math.round(m.cpu * 10) / 10,
    RAM: Math.round(m.memory * 10) / 10,
    Disk: Math.round(m.disk * 10) / 10,
    IOWait: m.cpuIoWait != null ? Math.round(m.cpuIoWait * 10) / 10 : 0,
  })) ?? [];

  const diskIOData = metrics?.filter((m) => m.diskReadBps != null).map((m) => ({
    time: formatTime(m.createdAt),
    Read: m.diskReadBps ?? 0,
    Write: m.diskWriteBps ?? 0,
  })) ?? [];

  const networkData = metrics?.filter((m) => m.netRxBps != null).map((m) => ({
    time: formatTime(m.createdAt),
    RX: m.netRxBps ?? 0,
    TX: m.netTxBps ?? 0,
  })) ?? [];

  const latest = metrics?.[metrics.length - 1];
  const tags = (server as any).tags as Array<{ key: string; value: string }> | undefined;

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/servers')} sx={{ mb: 2 }}>
        Back to Servers
      </Button>

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
            {server.agentVersion && <Chip label={`Agent v${server.agentVersion}`} variant="outlined" size="small" />}
          </Stack>
          {tags && tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              {tags.map((t) => (
                <Chip key={t.key} label={t.value ? `${t.key}:${t.value}` : t.key} size="small"
                  sx={{ fontSize: '0.65rem', bgcolor: 'action.selected' }} />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>

      {/* Live metrics cards — row 1 */}
      <Grid container spacing={2} mb={2}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">CPU</Typography>
              <Typography variant="h3" color={
                (latest?.cpu ?? 0) > 85 ? 'error.main' : (latest?.cpu ?? 0) > 60 ? 'warning.main' : 'success.main'
              }>
                {latest ? `${Math.round(latest.cpu)}%` : '-'}
              </Typography>
              {latest?.cpuIoWait != null && latest.cpuIoWait > 0 && (
                <Typography variant="caption" color={latest.cpuIoWait > 20 ? 'error.main' : 'text.secondary'}>
                  IOWait: {latest.cpuIoWait.toFixed(1)}%
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">RAM</Typography>
              <Typography variant="h3" color={
                (latest?.memory ?? 0) > 85 ? 'error.main' : (latest?.memory ?? 0) > 60 ? 'warning.main' : 'success.main'
              }>
                {latest ? `${Math.round(latest.memory)}%` : '-'}
              </Typography>
              <Stack direction="row" spacing={1}>
                {server.totalRamMb != null && (
                  <Typography variant="caption" color="text.secondary">
                    {server.totalRamMb >= 1024 ? `${(server.totalRamMb / 1024).toFixed(1)} GB` : `${server.totalRamMb} MB`}
                  </Typography>
                )}
                {latest?.swapUsedPct != null && latest.swapUsedPct > 0 && (
                  <Typography variant="caption" color={latest.swapUsedPct > 50 ? 'warning.main' : 'text.secondary'}>
                    Swap: {Math.round(latest.swapUsedPct)}%
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Disk</Typography>
              <Typography variant="h3" color={
                (latest?.disk ?? 0) > 90 ? 'error.main' : (latest?.disk ?? 0) > 75 ? 'warning.main' : 'success.main'
              }>
                {latest ? `${Math.round(latest.disk)}%` : '-'}
              </Typography>
              <Stack direction="row" spacing={1}>
                {server.totalDiskGb != null && (
                  <Typography variant="caption" color="text.secondary">{server.totalDiskGb} GB</Typography>
                )}
                {latest?.diskIoUtil != null && latest.diskIoUtil > 0 && (
                  <Typography variant="caption" color={latest.diskIoUtil > 80 ? 'error.main' : 'text.secondary'}>
                    I/O: {latest.diskIoUtil.toFixed(0)}%
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Load Average</Typography>
              <Typography variant="h3" color={
                (latest?.loadAvg1 ?? 0) > (server.cpuCores ?? 1) ? 'error.main' :
                (latest?.loadAvg1 ?? 0) > (server.cpuCores ?? 1) * 0.7 ? 'warning.main' : 'success.main'
              }>
                {latest?.loadAvg1 != null ? latest.loadAvg1.toFixed(2) : '-'}
              </Typography>
              {latest?.loadAvg5 != null && (
                <Typography variant="caption" color="text.secondary">
                  {latest.loadAvg5.toFixed(2)} / {(latest.loadAvg15 ?? 0).toFixed(2)}
                  {server.cpuCores ? ` (${server.cpuCores} cores)` : ''}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Live metrics cards — row 2: Network + OS */}
      <Grid container spacing={2} mb={3}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Network RX</Typography>
              <Typography variant="h5">
                {latest?.netRxBps != null ? formatBytes(latest.netRxBps) : '-'}
              </Typography>
              {latest?.netErrors != null && latest.netErrors > 0 && (
                <Typography variant="caption" color="error.main">
                  {latest.netErrors} errors
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Network TX</Typography>
              <Typography variant="h5">
                {latest?.netTxBps != null ? formatBytes(latest.netTxBps) : '-'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">Disk I/O</Typography>
              <Typography variant="h6">
                {latest?.diskReadBps != null ? `R: ${formatBytes(latest.diskReadBps)}` : '-'}
              </Typography>
              <Typography variant="h6">
                {latest?.diskWriteBps != null ? `W: ${formatBytes(latest.diskWriteBps)}` : '-'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="caption" color="text.secondary">OS</Typography>
              <Typography variant="h6">{server.osFamily ?? 'Unknown'} {server.osVersion ?? ''}</Typography>
              {server.kernel && (
                <Typography variant="caption" color="text.secondary" noWrap>{server.kernel}</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* CPU / RAM / Disk chart */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" mb={2}>CPU / RAM / Disk (last 24h)</Typography>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.5)" fontSize={12} unit="%" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)' }} />
                <Legend />
                <Line type="monotone" dataKey="CPU" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="RAM" stroke="#22d3ee" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Disk" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="IOWait" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No metrics data yet. Waiting for agent heartbeats...
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Disk I/O + Network throughput charts side by side */}
      <Grid container spacing={2} mb={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2}>Disk I/O</Typography>
              {diskIOData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={diskIOData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="time" stroke="rgba(255,255,255,0.5)" fontSize={11} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11}
                      tickFormatter={(v: number) => v >= 1048576 ? `${(v / 1048576).toFixed(0)}M` : v >= 1024 ? `${(v / 1024).toFixed(0)}K` : `${v}`} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)' }}
                      formatter={(v: number) => formatBytes(v)} />
                    <Legend />
                    <Area type="monotone" dataKey="Read" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.15} strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="Write" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">No disk I/O data yet.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2}>Network Throughput</Typography>
              {networkData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={networkData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="time" stroke="rgba(255,255,255,0.5)" fontSize={11} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11}
                      tickFormatter={(v: number) => v >= 1048576 ? `${(v / 1048576).toFixed(0)}M` : v >= 1024 ? `${(v / 1024).toFixed(0)}K` : `${v}`} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)' }}
                      formatter={(v: number) => formatBytes(v)} />
                    <Legend />
                    <Area type="monotone" dataKey="RX" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="TX" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">No network data yet.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* System Information */}
      <Card>
        <CardContent>
          <Typography variant="h6" mb={2}>System Information</Typography>
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
    </Box>
  );
}

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
