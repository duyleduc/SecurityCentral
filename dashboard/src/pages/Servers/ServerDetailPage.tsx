import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useServer, useServerMetrics } from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  })) ?? [];

  const latest = metrics?.[metrics.length - 1];

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/servers')} sx={{ mb: 2 }}>
        Back to Servers
      </Button>

      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <ScoreBadge score={computeScore({}).score} breakdown={computeScore({}).breakdown} size="medium" />
        <Typography variant="h4">{server.hostname}</Typography>
        <Chip
          label={server.status}
          color={server.status === 'online' ? 'success' : server.status === 'critical' ? 'error' : server.status === 'warning' ? 'warning' : 'default'}
        />
        {server.agentVersion && <Chip label={`Agent v${server.agentVersion}`} variant="outlined" />}
      </Box>

      {/* System info cards */}
      <Grid container spacing={3} mb={4}>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">CPU</Typography>
              <Typography variant="h3" color={
                (latest?.cpu ?? 0) > 85 ? 'error.main' : (latest?.cpu ?? 0) > 60 ? 'warning.main' : 'success.main'
              }>
                {latest ? `${Math.round(latest.cpu)}%` : '-'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">RAM</Typography>
              <Typography variant="h3" color={
                (latest?.memory ?? 0) > 85 ? 'error.main' : (latest?.memory ?? 0) > 60 ? 'warning.main' : 'success.main'
              }>
                {latest ? `${Math.round(latest.memory)}%` : '-'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">Disk</Typography>
              <Typography variant="h3" color={
                (latest?.disk ?? 0) > 90 ? 'error.main' : (latest?.disk ?? 0) > 75 ? 'warning.main' : 'success.main'
              }>
                {latest ? `${Math.round(latest.disk)}%` : '-'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">OS</Typography>
              <Typography variant="h6">
                {server.osFamily ?? 'Unknown'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {server.osVersion ?? ''}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Metrics chart */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" mb={2}>Metrics (last 24h)</Typography>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.5)" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <Legend />
                <Line type="monotone" dataKey="CPU" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="RAM" stroke="#22d3ee" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Disk" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No metrics data yet. Waiting for agent heartbeats...
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Server info */}
      <Card>
        <CardContent>
          <Typography variant="h6" mb={2}>Server Info</Typography>
          <Grid container spacing={2}>
            {[
              ['Hostname', server.hostname],
              ['Agent ID', server.agentId ?? 'N/A'],
              ['Agent Version', server.agentVersion ?? 'N/A'],
              ['OS', `${server.osFamily ?? 'Unknown'} ${server.osVersion ?? ''}`],
              ['Last Heartbeat', server.lastHeartbeat ? new Date(server.lastHeartbeat).toLocaleString() : 'Never'],
              ['Registered', new Date(server.createdAt).toLocaleString()],
            ].map(([label, value]) => (
              <Grid key={label} size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">{label}</Typography>
                <Typography variant="body1">{value}</Typography>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
}
