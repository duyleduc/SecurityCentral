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
  InputAdornment,
  Stack,
  MenuItem,
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
import { HealthChip, OpStateChip } from '../../components/status';
import { ScoreBadge } from '../../components/ScoreBadge';
import { StatusPill } from '../../components/design';
import { useProjectScope } from '../../lib/useProjectScope';
import { healthFromServerStatus, opStateFromServerStatus, type Health } from '../../lib/status';

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

export function ServersPage() {
  const { projectId: scopedProjectId } = useProjectScope();
  const { data: servers, isLoading } = useServers(scopedProjectId);
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
  const [hostSearch, setHostSearch] = useState('');
  /** Health filter from clicking a status pill. Null = show all. */
  const [healthFilter, setHealthFilter] = useState<Health | null>(null);

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

  // Scope (project) + tag filtered, but health-unfiltered — so cards show accurate distribution.
  const scopedServers = useMemo(
    () => (servers ?? []).filter((s) => {
      if (!matchesTagQuery(s, tagQuery)) return false;
      if (scopedProjectId && s.projectId !== scopedProjectId) return false;
      return true;
    }),
    [servers, tagQuery, scopedProjectId],
  );

  const filteredServers = useMemo(
    () => scopedServers.filter((s) => {
      if (healthFilter && healthFromServerStatus(s.status) !== healthFilter) return false;
      if (hostSearch) {
        const q = hostSearch.toLowerCase();
        const haystack = `${s.hostname} ${s.label ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }),
    [scopedServers, healthFilter, hostSearch],
  );

  const healthyCount  = scopedServers.filter((s) => healthFromServerStatus(s.status) === 'healthy').length;
  const atRiskCount   = scopedServers.filter((s) => healthFromServerStatus(s.status) === 'at-risk').length;
  const criticalCount = scopedServers.filter((s) => healthFromServerStatus(s.status) === 'critical').length;
  const unknownCount  = scopedServers.filter((s) => healthFromServerStatus(s.status) === 'unknown').length;

  const applyTagFilter = (expr: string) => {
    setTagInput(expr);
    setTagQuery(expr);
  };

  const toggleHealth = (h: Health) => {
    setHealthFilter((prev) => (prev === h ? null : h));
  };

  const hasFilters = !!healthFilter || !!tagQuery || !!hostSearch;
  const clearAll = () => {
    setHealthFilter(null);
    setTagQuery('');
    setTagInput('');
    setHostSearch('');
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4">Servers</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Agent-monitored hosts ·{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
              {scopedServers.length} {scopedServers.length === 1 ? 'server' : 'servers'}
            </Box>
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add Server
        </Button>
      </Stack>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.25, px: 1.75, '&:last-child': { pb: 1.25 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <StatusPill label="All" count={scopedServers.length} active={healthFilter === null} onClick={() => setHealthFilter(null)} />
              <StatusPill label="Healthy" color="#22c55e" count={healthyCount} active={healthFilter === 'healthy'} onClick={() => toggleHealth('healthy')} />
              <StatusPill label="At-risk" color="#f59e0b" count={atRiskCount} active={healthFilter === 'at-risk'} onClick={() => toggleHealth('at-risk')} />
              <StatusPill label="Critical" color="#ef4444" count={criticalCount} active={healthFilter === 'critical'} onClick={() => toggleHealth('critical')} />
              <StatusPill label="Unknown" color="#94a3b8" count={unknownCount} active={healthFilter === 'unknown'} onClick={() => toggleHealth('unknown')} />
            </Stack>

            <Box sx={{ flex: 1 }} />

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small" placeholder="Search hosts" value={hostSearch}
                onChange={(e) => setHostSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                    endAdornment: hostSearch ? (
                      <IconButton size="small" onClick={() => setHostSearch('')}>
                        <ClearIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    ) : null,
                  },
                }}
                sx={{ width: 200 }}
              />
              <TextField
                size="small" placeholder="Tags: env=prod, tier=web" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setTagQuery(tagInput); }}
                onBlur={() => setTagQuery(tagInput)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <FilterListIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                    endAdornment: tagInput ? (
                      <IconButton size="small" onClick={() => { setTagInput(''); setTagQuery(''); }}>
                        <ClearIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    ) : null,
                  },
                }}
                sx={{ width: 240, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
              />
              {hasFilters && (
                <Button size="small" onClick={clearAll} sx={{ textTransform: 'none', color: 'text.secondary' }}>
                  Clear
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {isLoading && <Typography>Loading...</Typography>}

      {/* Server cards — mockup-aligned: grade badge + hostname + health/op chips + tags + heartbeat */}
      <Grid container spacing={3}>
        {filteredServers.map((srv) => (
          <Grid key={srv.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: '100%' }}>
              <CardActionArea
                onClick={() => navigate(`/servers/${srv.id}`)}
                sx={{ height: '100%', alignItems: 'stretch' }}
              >
                <CardContent>
                  {/* Header: grade + name + OS metadata */}
                  <Box display="flex" alignItems="center" gap={1.5} mb={1.5}>
                    {srv.securityScore != null
                      ? <ScoreBadge score={srv.securityScore} size="medium" />
                      : <StorageIcon color="disabled" sx={{ fontSize: 40 }} />}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="h6" noWrap>{srv.label || srv.hostname}</Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }} noWrap>
                        {srv.osFamily ? `${srv.osFamily} ${srv.osVersion ?? ''}` : '—'}
                        {srv.agentVersion ? ` · agent v${srv.agentVersion}` : ''}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Health + op state */}
                  <Box display="flex" gap={0.5} flexWrap="wrap" mb={1} alignItems="center">
                    <HealthChip health={healthFromServerStatus(srv.status)} />
                    <OpStateChip state={opStateFromServerStatus(srv.status)} />
                    {srv.agentVersion && latestAgent?.version && srv.agentVersion !== latestAgent.version && srv.agentVersion !== 'dev' && (
                      <Chip icon={<UpgradeIcon sx={{ fontSize: 14 }} />} label="update" size="small" color="info" variant="outlined" />
                    )}
                  </Box>

                  {/* Hostname (monospace) */}
                  <Box display="flex" gap={0.5} flexWrap="wrap" mb={1} alignItems="center">
                    <Chip
                      icon={<StorageIcon sx={{ fontSize: 14 }} />}
                      label={srv.hostname}
                      size="small"
                      variant="outlined"
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                    />
                    {srv.project && (
                      <Chip
                        icon={<FolderIcon sx={{ fontSize: 14 }} />}
                        label={srv.project.name}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>

                  {/* Tags */}
                  {srv.tags.length > 0 && (
                    <Box display="flex" gap={0.5} flexWrap="wrap" mb={1} alignItems="center" onClick={(e) => e.stopPropagation()}>
                      {srv.tags.map((t) => {
                        const filterExpr = t.value ? `${t.key}=${t.value}` : t.key;
                        return (
                          <Chip
                            key={t.key}
                            label={t.value ? `${t.key}=${t.value}` : t.key}
                            size="small"
                            variant="outlined"
                            clickable
                            onClick={() => applyTagFilter(filterExpr)}
                            sx={{ fontFamily: 'monospace', fontSize: '0.65rem', height: 20, borderColor: 'primary.dark', cursor: 'pointer' }}
                          />
                        );
                      })}
                    </Box>
                  )}

                  {/* Heartbeat footer */}
                  {srv.lastHeartbeat && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      Heartbeat: {new Date(srv.lastHeartbeat).toLocaleString()}
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
