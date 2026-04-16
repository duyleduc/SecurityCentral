import { useState, useEffect } from 'react';
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
  Tabs,
  Tab,
  IconButton,
  Stack,
  MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import UpgradeIcon from '@mui/icons-material/SystemUpdateAlt';
import { useServers, useProjects, useCreateInstallToken, useAgentLatestVersion, type InstallToken } from '../../api/hooks';
import { TagsInput, type Tag } from '../../components/TagsInput';

function StatusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'online': return 'success';
    case 'warning': return 'warning';
    case 'critical':
    case 'offline':
    case 'dead': return 'error';
    default: return 'default';
  }
}

export function ServersPage() {
  const { data: servers, isLoading } = useServers();
  const { data: projects } = useProjects();
  const { data: latestAgent } = useAgentLatestVersion();
  const createToken = useCreateInstallToken();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [label, setLabel] = useState('');
  const [projectId, setProjectId] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [arch, setArch] = useState<'amd64' | 'arm64'>('amd64');
  const [token, setToken] = useState<InstallToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiresIn, setExpiresIn] = useState('');

  const apiUrl = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3000';

  // Countdown timer
  useEffect(() => {
    if (step !== 2 || !token?.expiresAt) return;
    const update = () => {
      const diff = new Date(token.expiresAt).getTime() - Date.now();
      if (diff <= 0) { setExpiresIn('Expired'); return; }
      setExpiresIn(`${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [step, token?.expiresAt]);

  const handleGenerate = async () => {
    const result = await createToken.mutateAsync({
      label: label || 'New server',
      projectId: projectId || undefined,
      tags: tags.length > 0 ? tags : undefined,
    });
    setToken(result);
    setStep(2);
  };

  const handleClose = () => {
    setOpen(false);
    setStep(1);
    setToken(null);
    setLabel('');
    setProjectId('');
    setTags([]);
    setCopied(false);
    setExpiresIn('');
  };

  const installCommand = token
    ? [
        `# Download the agent binary (${arch})`,
        `curl -fsSL -o sc-agent ${apiUrl}/v1/agents/download?arch=${arch}`,
        ``,
        `# Install and register`,
        `chmod +x sc-agent`,
        `sudo ./sc-agent install --token ${token.rawToken} --api-url ${apiUrl}`,
        ``,
        `# Start the agent`,
        `sudo ./sc-agent run`,
      ].join('\n')
    : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const online = servers?.filter((s) => s.status === 'online').length ?? 0;
  const warning = servers?.filter((s) => s.status === 'warning').length ?? 0;
  const critical = servers?.filter((s) => s.status === 'critical').length ?? 0;
  const offline = servers?.filter((s) => s.status === 'offline' || s.status === 'dead').length ?? 0;

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
          { label: 'Offline', value: offline, color: 'error.main' },
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
                    <Typography variant="h6" noWrap>{srv.label || srv.hostname}</Typography>
                  </Box>
                  <Box display="flex" gap={0.5} flexWrap="wrap" mb={1}>
                    <Chip icon={<StorageIcon sx={{ fontSize: 14 }} />} label={srv.hostname} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }} />
                    <Chip label={srv.status} size="small" color={StatusColor(srv.status)} />
                    {srv.project && (
                      <Chip icon={<FolderIcon sx={{ fontSize: 14 }} />} label={srv.project.name} size="small" variant="outlined" />
                    )}
                    {srv.tags.map((t) => (
                      <Chip key={t.key} label={t.value ? `${t.key}: ${t.value}` : t.key} size="small"
                        variant="outlined" sx={{ fontSize: '0.7rem', borderColor: 'primary.dark' }} />
                    ))}
                    {srv.agentVersion && latestAgent?.version && srv.agentVersion !== latestAgent.version && srv.agentVersion !== 'dev' && (
                      <Chip icon={<UpgradeIcon sx={{ fontSize: 14 }} />} label="update" size="small" color="info" variant="outlined" />
                    )}
                  </Box>
                  {srv.osFamily && (
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                      {srv.osFamily} {srv.osVersion ?? ''} {srv.agentVersion ? `· agent v${srv.agentVersion}` : ''}
                    </Typography>
                  )}
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
          {step === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Configure your server, then generate an install command to run on the target machine.
              </Typography>
              <TextField
                fullWidth size="small"
                label="Label (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., prod-web-1"
              />
              <TextField
                fullWidth size="small" select
                label="Project (optional)"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <MenuItem value="">None</MenuItem>
                {projects?.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </TextField>
              <TagsInput tags={tags} onChange={setTags} existingKeys={[]} />

              {createToken.isError && (
                <Alert severity="error">Failed to create install token. Please try again.</Alert>
              )}
            </Box>
          )}

          {step === 2 && token && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Alert severity="info">
                Run this command on the target server. Token expires in <strong>{expiresIn}</strong>.
              </Alert>

              <Tabs value={arch} onChange={(_, v) => setArch(v)} sx={{ minHeight: 36 }}>
                <Tab label="Linux amd64" value="amd64" sx={{ minHeight: 36, py: 0 }} />
                <Tab label="Linux arm64" value="arm64" sx={{ minHeight: 36, py: 0 }} />
              </Tabs>

              <Box sx={{ position: 'relative' }}>
                <TextField
                  multiline fullWidth minRows={3}
                  value={installCommand}
                  slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } } }}
                />
                <IconButton size="small" onClick={handleCopy} sx={{ position: 'absolute', top: 8, right: 8 }} title="Copy to clipboard">
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Box>
              {copied && <Typography variant="caption" color="success.main">Copied to clipboard</Typography>}

              <Typography variant="body2" color="text.secondary">
                The agent binary handles everything: registration, config creation, and systemd service setup.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>{step === 2 ? 'Done' : 'Cancel'}</Button>
          {step === 1 && (
            <Button variant="contained" onClick={handleGenerate} disabled={createToken.isPending}>
              {createToken.isPending ? 'Generating...' : 'Generate Install Command'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
