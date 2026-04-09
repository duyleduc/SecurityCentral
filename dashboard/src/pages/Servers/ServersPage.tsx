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
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useServers, useCreateInstallToken, type InstallToken } from '../../api/hooks';

function StatusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'online': return 'success';
    case 'warning': return 'warning';
    case 'critical': return 'error';
    default: return 'default';
  }
}

export function ServersPage() {
  const { data: servers, isLoading } = useServers();
  const createToken = useCreateInstallToken();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [token, setToken] = useState<InstallToken | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    const result = await createToken.mutateAsync({ label: label || 'New server' });
    setToken(result);
  };

  const handleClose = () => {
    setOpen(false);
    setToken(null);
    setLabel('');
    setCopied(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const online = servers?.filter((s) => s.status === 'online').length ?? 0;
  const warning = servers?.filter((s) => s.status === 'warning').length ?? 0;
  const critical = servers?.filter((s) => s.status === 'critical').length ?? 0;
  const offline = servers?.filter((s) => s.status === 'offline').length ?? 0;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Servers</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add Server
        </Button>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={3} mb={4}>
        {[
          { label: 'Online', value: online, color: 'success.main' },
          { label: 'Warning', value: warning, color: 'warning.main' },
          { label: 'Critical', value: critical, color: 'error.main' },
          { label: 'Offline', value: offline, color: 'text.secondary' },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="h3" color={s.color}>{s.value}</Typography>
                <Typography variant="body2" color="text.secondary">{s.label}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {isLoading && <Typography>Loading...</Typography>}

      {/* Server cards */}
      <Grid container spacing={3}>
        {servers?.map((srv) => (
          <Grid key={srv.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardActionArea onClick={() => navigate(`/servers/${srv.id}`)}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <StorageIcon color={srv.status === 'online' ? 'success' : srv.status === 'critical' ? 'error' : 'disabled'} />
                    <Typography variant="h6" noWrap>{srv.hostname}</Typography>
                  </Box>
                  <Box display="flex" gap={1} flexWrap="wrap" mb={1}>
                    <Chip label={srv.status} size="small" color={StatusColor(srv.status)} />
                    {srv.osFamily && <Chip label={srv.osFamily} size="small" variant="outlined" />}
                    {srv.agentVersion && <Chip label={`v${srv.agentVersion}`} size="small" variant="outlined" />}
                  </Box>
                  {srv.lastHeartbeat && (
                    <Typography variant="caption" color="text.secondary">
                      Last heartbeat: {new Date(srv.lastHeartbeat).toLocaleString()}
                    </Typography>
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Add Server Dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Add Server</DialogTitle>
        <DialogContent>
          {!token ? (
            <>
              <Typography variant="body2" color="text.secondary" mb={2}>
                Generate an install token, then run the agent install command on your server.
              </Typography>
              <TextField
                fullWidth
                label="Label (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                margin="normal"
                placeholder="e.g., prod-web-1"
              />
            </>
          ) : (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Install token created! Copy the command below and run it on your server.
              </Alert>

              <Typography variant="subtitle2" mb={1}>Install command:</Typography>
              <Box
                sx={{
                  bgcolor: 'background.default',
                  p: 2,
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  position: 'relative',
                  wordBreak: 'break-all',
                }}
              >
                sc-agent install --token {token.rawToken} --api-url http://YOUR_API_HOST:3000
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => handleCopy(`sc-agent install --token ${token.rawToken} --api-url http://YOUR_API_HOST:3000`)}
                  sx={{ position: 'absolute', top: 4, right: 4 }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </Box>

              <Typography variant="body2" color="text.secondary" mt={2}>
                Token expires: {new Date(token.expiresAt).toLocaleString()}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Close</Button>
          {!token && (
            <Button variant="contained" onClick={handleCreate} disabled={createToken.isPending}>
              Generate Token
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
