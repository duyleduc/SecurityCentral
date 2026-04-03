import { useState, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Stack, Divider,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, IconButton, Tabs, Tab, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { useServers, useServer, useAgentVersion, type Server } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';
import { SEVERITY_COLORS } from '../../theme/theme.js';
import AddServerDialog from '../../components/AddServerDialog.js';

const ENV_COLOR: Record<string, 'error' | 'warning' | 'primary'> = {
  production: 'error',
  staging: 'warning',
  development: 'primary',
};

const STATUS_DOT: Record<string, string> = { active: '#16a34a', inactive: '#dc2626', decommissioned: '#6b7280' };

function relativeTime(dateStr?: string): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ServersList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const servers = useServers({ page, per_page: 25 });
  const { data: versionInfo } = useAgentVersion();
  const data = servers.data?.data as (Server & { openFindingCount?: number; agentVersion?: string })[] | undefined;
  const meta = servers.data?.meta;

  const latestVersion = versionInfo?.version ?? '';
  const outdatedCount = data?.filter((s) => s.agentVersion && s.agentVersion !== latestVersion).length ?? 0;

  if (selectedId) return <ServerDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Servers</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setShowAddDialog(true)}>
          Add Server
        </Button>
      </Stack>
      <AddServerDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
      {outdatedCount > 0 && latestVersion && (
        <Alert severity="warning" icon={<SystemUpdateAltIcon fontSize="small" />} sx={{ mb: 2 }}>
          {outdatedCount} {outdatedCount === 1 ? 'server has' : 'servers have'} an outdated agent.
          Latest version: <strong>v{latestVersion}</strong>. Click a server to update.
        </Alert>
      )}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Hostname</TableCell>
              <TableCell>OS</TableCell>
              <TableCell>Agent</TableCell>
              <TableCell>Environment</TableCell>
              <TableCell>Last Heartbeat</TableCell>
              <TableCell align="right">Findings</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {servers.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>No servers</TableCell>
              </TableRow>
            ) : data.map((s) => {
              const isOutdated = latestVersion && s.agentVersion && s.agentVersion !== latestVersion;
              return (
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
                  <TableCell>
                    <FiberManualRecordIcon sx={{ fontSize: 10, color: STATUS_DOT[s.status] ?? '#6b7280' }} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 500 }}>{s.hostname}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{s.osFamily} {s.osVersion}</TableCell>
                  <TableCell>
                    <Chip
                      label={s.agentVersion ? `v${s.agentVersion}` : '—'}
                      size="small"
                      color={isOutdated ? 'warning' : 'default'}
                      variant={isOutdated ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip label={s.environment} size="small" color={ENV_COLOR[s.environment] ?? 'default'} />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{relativeTime(s.lastHeartbeat)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>{s.openFindingCount ?? 0}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Update Agent Dialog
// ---------------------------------------------------------------------------

function UpdateAgentDialog({ open, onClose, server }: { readonly open: boolean; readonly onClose: () => void; readonly server: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'simple' | 'manual'>('simple');
  const { data: versionInfo } = useAgentVersion();

  const arch = (server.arch as string) ?? 'amd64';
  const currentVersion = (server.agentVersion as string) ?? 'unknown';
  const latestVersion = versionInfo?.version ?? '...';
  const isUpToDate = currentVersion === latestVersion;

  // Derive API origin same as AddServerDialog
  const raw = import.meta.env.VITE_API_URL ?? '';
  let apiOrigin = 'http://localhost:3000';
  if (raw.startsWith('http')) {
    try { apiOrigin = new URL(raw).origin; } catch { /* use default */ }
  }

  const simpleCmd = 'sudo sc-agent update';
  const manualCmd = [
    `curl -fsSL -o /tmp/sc-agent-new ${apiOrigin}/v1/agents/download?arch=${arch}`,
    'chmod +x /tmp/sc-agent-new',
    'sudo mv /tmp/sc-agent-new /usr/local/bin/sc-agent',
    'sudo systemctl restart securitycentral-agent',
  ].join('\n');

  const activeCmd = tab === 'simple' ? simpleCmd : manualCmd;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(activeCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeCmd]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Update Agent</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity={isUpToDate ? 'success' : 'warning'}>
            {isUpToDate ? (
              <>Agent on <strong>{server.hostname as string}</strong> is up to date (<strong>v{currentVersion}</strong>)</>
            ) : (
              <>
                <strong>{server.hostname as string}</strong>: v{currentVersion} → <strong>v{latestVersion}</strong> available
              </>
            )}
          </Alert>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36 }}>
            <Tab label="Simple (recommended)" value="simple" sx={{ minHeight: 36, py: 0 }} />
            <Tab label="Manual" value="manual" sx={{ minHeight: 36, py: 0 }} />
          </Tabs>

          {tab === 'simple' && (
            <Typography variant="body2" color="text.secondary">
              Run this on the server. The agent reads its config, downloads the latest binary, replaces itself, and restarts.
            </Typography>
          )}
          {tab === 'manual' && (
            <Typography variant="body2" color="text.secondary">
              Download the binary manually, replace it, and restart the service.
            </Typography>
          )}

          <Box sx={{ position: 'relative' }}>
            <TextField
              multiline
              fullWidth
              minRows={tab === 'simple' ? 1 : 4}
              value={activeCmd}
              slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } } }}
            />
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{ position: 'absolute', top: 8, right: 8 }}
              title="Copy to clipboard"
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>

          {copied && (
            <Typography variant="caption" color="success.main">Copied to clipboard</Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Server Detail
// ---------------------------------------------------------------------------

function ServerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useServer(id);
  const server = envelope?.data as Record<string, unknown> | undefined;
  const { data: versionInfo } = useAgentVersion();
  const [showUpdate, setShowUpdate] = useState(false);

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={250} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!server) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography color="text.secondary">Not found</Typography>
      </Box>
    );
  }

  const findings = (server.recentFindings ?? []) as Array<Record<string, unknown>>;
  const counts = (server.findingCounts ?? {}) as Record<string, number>;
  const currentVersion = (server.agentVersion as string) ?? '';
  const latestVersion = versionInfo?.version ?? '';
  const hasUpdate = latestVersion !== '' && currentVersion !== '' && currentVersion !== latestVersion;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} size="small" onClick={onBack}>
          Back to Servers
        </Button>
        <Button
          variant={hasUpdate ? 'contained' : 'outlined'}
          color={hasUpdate ? 'warning' : 'inherit'}
          size="small"
          startIcon={<SystemUpdateAltIcon />}
          onClick={() => setShowUpdate(true)}
        >
          {hasUpdate ? `Update to v${latestVersion}` : 'Update Agent'}
        </Button>
      </Stack>
      <UpdateAgentDialog open={showUpdate} onClose={() => setShowUpdate(false)} server={server} />
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <FiberManualRecordIcon sx={{ fontSize: 12, color: STATUS_DOT[server.status as string] ?? '#6b7280' }} />
            <Typography variant="h6">{server.hostname as string}</Typography>
            <Chip label={server.environment as string} size="small" color={ENV_COLOR[server.environment as string] ?? 'default'} />
          </Stack>

          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            {([
              ['OS', `${server.osFamily as string} ${server.osVersion as string}`],
              ['Arch', server.arch as string],
              ['Agent', (server.agentVersion as string) ?? '-'],
              ['Cloud', (server.cloudProvider as string) ?? 'On-prem'],
              ['Region', (server.cloudRegion as string) ?? '-'],
              ['Heartbeat', relativeTime(server.lastHeartbeat as string)],
            ] as const).map(([label, value]) => (
              <Grid size={4} key={label}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                  {label}
                </Typography>
                <Typography variant="body2">{value}</Typography>
              </Grid>
            ))}
          </Grid>

          {Object.keys(counts).length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              {Object.entries(counts).map(([sev, count]) => (
                <Chip
                  key={sev}
                  label={`${sev}: ${count}`}
                  size="small"
                  sx={{ bgcolor: SEVERITY_COLORS[sev] ?? SEVERITY_COLORS.low, color: '#fff' }}
                />
              ))}
            </Stack>
          )}

          {findings.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent Findings</Typography>
              {findings.map((f) => (
                <Box key={f.id as string} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>{f.title as string}</Typography>
                  <Typography variant="body2" component="span" color="text.secondary" sx={{ ml: 1 }}>
                    ({f.severity as string})
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
