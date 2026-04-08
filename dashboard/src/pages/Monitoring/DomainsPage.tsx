import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DnsIcon from '@mui/icons-material/Dns';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import { useEndpoints, useCreateEndpoint, useProjects } from '../../api/hooks';

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'healthy':
      return <CheckCircleIcon color="success" />;
    case 'degraded':
      return <WarningIcon color="warning" />;
    case 'down':
      return <ErrorIcon color="error" />;
    default:
      return <DnsIcon color="disabled" />;
  }
}

export function DomainsPage() {
  const { data: endpoints, isLoading } = useEndpoints();
  const { data: projects } = useProjects();
  const createEndpoint = useCreateEndpoint();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [host, setHost] = useState('');
  const [projectId, setProjectId] = useState('');
  const [checkInterval, setCheckInterval] = useState('1h');

  const handleCreate = async () => {
    await createEndpoint.mutateAsync({
      host,
      projectId: projectId || undefined,
      checkInterval,
    });
    setOpen(false);
    setHost('');
    setProjectId('');
  };

  const healthy = endpoints?.filter((e) => e.status === 'healthy').length ?? 0;
  const degraded = endpoints?.filter((e) => e.status === 'degraded').length ?? 0;
  const down = endpoints?.filter((e) => e.status === 'down').length ?? 0;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Domains</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add Domain
        </Button>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={3} mb={4}>
        {[
          { label: 'Healthy', value: healthy, color: 'success.main' },
          { label: 'Degraded', value: degraded, color: 'warning.main' },
          { label: 'Down', value: down, color: 'error.main' },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent>
                <Typography variant="h3" color={s.color}>
                  {s.value}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {s.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {isLoading && <Typography>Loading...</Typography>}

      {/* Domain cards */}
      <Grid container spacing={3}>
        {endpoints?.map((ep) => {
          const lastHb = ep.heartbeats?.[0];
          return (
            <Grid key={ep.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card>
                <CardActionArea onClick={() => navigate(`/domains/${ep.id}`)}>
                  <CardContent>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <StatusIcon status={ep.status} />
                      <Typography variant="h6" noWrap>
                        {ep.host}
                      </Typography>
                    </Box>
                    <Box display="flex" gap={1} flexWrap="wrap" mb={1}>
                      <Chip
                        label={ep.status}
                        size="small"
                        color={ep.status === 'healthy' ? 'success' : ep.status === 'degraded' ? 'warning' : ep.status === 'down' ? 'error' : 'default'}
                      />
                      {lastHb?.sslDaysLeft != null && (
                        <Chip
                          label={`SSL: ${lastHb.sslDaysLeft}d`}
                          size="small"
                          color={lastHb.sslDaysLeft > 30 ? 'success' : lastHb.sslDaysLeft > 7 ? 'warning' : 'error'}
                        />
                      )}
                      {ep.project && <Chip label={ep.project.name} size="small" variant="outlined" />}
                    </Box>
                    {ep.lastCheckAt && (
                      <Typography variant="caption" color="text.secondary">
                        Last check: {new Date(ep.lastCheckAt).toLocaleString()}
                      </Typography>
                    )}
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Add domain dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Domain</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Domain (e.g. google.com)"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            margin="normal"
            autoFocus
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Project (optional)</InputLabel>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} label="Project (optional)">
              <MenuItem value="">None</MenuItem>
              {projects?.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth margin="normal">
            <InputLabel>Check Interval</InputLabel>
            <Select value={checkInterval} onChange={(e) => setCheckInterval(e.target.value)} label="Check Interval">
              <MenuItem value="1h">Every hour</MenuItem>
              <MenuItem value="6h">Every 6 hours</MenuItem>
              <MenuItem value="24h">Every 24 hours</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!host || createEndpoint.isPending}>
            Add Domain
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
