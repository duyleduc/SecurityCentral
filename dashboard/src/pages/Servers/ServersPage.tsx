import { useState, useEffect, useMemo } from 'react';
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
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import UpgradeIcon from '@mui/icons-material/SystemUpdateAlt';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import { useServers, useProjects, useCreateInstallToken, useAgentLatestVersion, type InstallToken, type Server } from '../../api/hooks';
import { TagsInput, type Tag } from '../../components/TagsInput';

/**
 * Match a server's tags against a comma-separated query.
 * Each term is either "key" (match key presence) or "key=value" (match exact value).
 * A server matches if ALL terms match at least one tag.
 */
function matchesTagQuery(server: Server, query: string): boolean {
  if (!query.trim()) return true;
  const terms = query.split(',').map((t) => t.trim()).filter(Boolean);
  return terms.every((term) => {
    const [k, v] = term.includes('=') ? term.split('=').map((s) => s.trim()) : [term.trim(), undefined];
    return server.tags.some((t) => t.key === k && (v === undefined || t.value === v));
  });
}

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
  const [tagQuery, setTagQuery] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');

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

  // Tag + project filtered but status-unfiltered, so cards show accurate distribution.
  const tagFilteredServers = useMemo(
    () => (servers ?? []).filter((s) => {
      if (!matchesTagQuery(s, tagQuery)) return false;
      if (projectFilter && s.projectId !== projectFilter) return false;
      return true;
    }),
    [servers, tagQuery, projectFilter],
  );

  const filteredServers = useMemo(
    () => tagFilteredServers.filter((s) => {
      if (!statusFilter) return true;
      if (statusFilter === 'offline') return s.status === 'offline' || s.status === 'dead';
      return s.status === statusFilter;
    }),
    [tagFilteredServers, statusFilter],
  );

  const online = tagFilteredServers.filter((s) => s.status === 'online').length;
  const warning = tagFilteredServers.filter((s) => s.status === 'warning').length;
  const critical = tagFilteredServers.filter((s) => s.status === 'critical').length;
  const offline = tagFilteredServers.filter((s) => s.status === 'offline' || s.status === 'dead').length;

  const applyTagFilter = (expr: string) => {
    setTagInput(expr);
    setTagQuery(expr);
  };

  const toggleStatus = (status: string) => {
    setStatusFilter((prev) => (prev === status ? '' : status));
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Servers</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add Server
        </Button>
      </Box>

      {/* Summary cards — click to filter, click again to clear */}
      <Grid container spacing={3} mb={4}>
        {[
          { label: 'Online', value: online, color: 'success.main', status: 'online' },
          { label: 'Warning', value: warning, color: 'warning.main', status: 'warning' },
          { label: 'Critical', value: critical, color: 'error.main', status: 'critical' },
          { label: 'Offline', value: offline, color: 'error.main', status: 'offline' },
        ].map((s) => {
          const active = statusFilter === s.status;
          return (
            <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
              <Card sx={{
                border: '2px solid',
                borderColor: active ? s.color : 'transparent',
                transition: 'border-color 0.15s',
              }}>
                <CardActionArea onClick={() => toggleStatus(s.status)}>
                  <CardContent>
                    <Typography variant="h3" color={s.color}>{s.value}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {s.label}{active && ' · filtering'}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Filters */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <FilterListIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Project</InputLabel>
          <Select
            value={projectFilter}
            label="Project"
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <MenuItem value="">All projects</MenuItem>
            {projects?.map((p) => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="Filter by tags: env=prod, tier=web"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setTagQuery(tagInput); }}
          slotProps={{
            input: {
              endAdornment: tagInput ? (
                <IconButton size="small" onClick={() => { setTagInput(''); setTagQuery(''); }}>
                  <ClearIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ) : (
                <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              ),
            },
          }}
          sx={{ width: 320 }}
        />
        {tagInput && tagInput !== tagQuery && (
          <Button size="small" variant="outlined" onClick={() => setTagQuery(tagInput)}>Apply</Button>
        )}
        {(tagQuery || projectFilter || statusFilter) && (
          <Chip
            label={`${filteredServers.length} of ${servers?.length ?? 0} match`}
            size="small"
            variant="outlined"
            onDelete={() => { applyTagFilter(''); setProjectFilter(''); setStatusFilter(''); }}
          />
        )}
      </Stack>

      {isLoading && <Typography>Loading...</Typography>}

      {/* Server cards */}
      <Grid container spacing={3}>
        {filteredServers.map((srv) => (
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
                      <Chip
                        icon={<FolderIcon sx={{ fontSize: 14 }} />}
                        label={srv.project.name}
                        size="small"
                        variant="outlined"
                        clickable
                        onClick={(e) => { e.stopPropagation(); setProjectFilter(srv.project!.id); }}
                      />
                    )}
                    {srv.tags.map((t) => {
                      const filterExpr = t.value ? `${t.key}=${t.value}` : t.key;
                      return (
                        <Chip
                          key={t.key}
                          label={t.value ? `${t.key}: ${t.value}` : t.key}
                          size="small"
                          variant="outlined"
                          clickable
                          onClick={(e) => { e.stopPropagation(); applyTagFilter(filterExpr); }}
                          sx={{ fontSize: '0.7rem', borderColor: 'primary.dark', cursor: 'pointer' }}
                        />
                      );
                    })}
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
