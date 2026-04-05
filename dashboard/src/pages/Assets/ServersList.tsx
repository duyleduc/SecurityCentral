import { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Stack, Divider,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, IconButton, Tabs, Tab, Alert,
  Checkbox, FormControlLabel, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MemoryIcon from '@mui/icons-material/Memory';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import LinearProgress from '@mui/material/LinearProgress';
import { useServers, useServer, useAgentVersion, useUpdateServerConfig, type Server } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';
import { SEVERITY_COLORS } from '../../theme/theme.js';

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
  const servers = useServers({ page, per_page: 25 });
  const { data: versionInfo } = useAgentVersion();
  const data = servers.data?.data as (Server & { openFindingCount?: number; agentVersion?: string })[] | undefined;
  const meta = servers.data?.meta;

  const latestVersion = versionInfo?.version ?? '';
  const outdatedCount = data?.filter((s) => s.agentVersion && s.agentVersion !== latestVersion).length ?? 0;

  if (selectedId) return <ServerDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Servers</Typography>
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

          <ServerInfoGrid server={server} />

          <ServerResourceUsage metadata={server.metadata as Record<string, unknown> | undefined} />

          <ServerSystemInfo metadata={server.metadata as Record<string, unknown> | undefined} />

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

          <Divider sx={{ my: 2 }} />
          <AgentSettings serverId={server.id as string} metadata={server.metadata as Record<string, unknown> | undefined} />
        </CardContent>
      </Card>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Server Info Grid
// ---------------------------------------------------------------------------

function ServerInfoGrid({ server }: { readonly server: Record<string, unknown> }) {
  const metadata = (server.metadata ?? {}) as Record<string, unknown>;
  const sysInfo = (metadata.systemInfo ?? {}) as Record<string, unknown>;
  const cloud = (server.cloudProvider as string) ?? '';

  const status = server.status as string;
  const lastScan = server.lastScanAt as string | null;
  const createdAt = server.createdAt as string;

  const fields: [string, string][] = [
    ['Status', status],
    ['OS', `${server.osFamily as string} ${server.osVersion as string}`],
    ['Arch', server.arch as string],
    ['Kernel', (sysInfo.kernel as string) ?? '-'],
    ['Agent Version', (server.agentVersion as string) ?? '-'],
    ['Agent ID', (server.agentId as string) ?? '-'],
    ['Cloud', cloud ? `${cloud.toUpperCase()} — ${(server.cloudRegion as string) ?? ''}` : 'On-prem'],
    ['Last Heartbeat', relativeTime(server.lastHeartbeat as string)],
    ['Last Scan', lastScan ? relativeTime(lastScan) : 'Never'],
    ['Registered', new Date(createdAt).toLocaleDateString()],
  ];

  const ips = (sysInfo.ipAddresses ?? []) as string[];
  if (ips.length > 0) {
    fields.push(['IP Addresses', ips.join(', ')]);
  }

  const instanceId = server.cloudInstanceId as string;
  if (instanceId) {
    fields.push(['Instance ID', instanceId]);
  }

  return (
    <Grid container spacing={2} sx={{ mb: 2.5 }}>
      {fields.map(([label, value]) => (
        <Grid size={4} key={label}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
            {label}
          </Typography>
          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{value}</Typography>
        </Grid>
      ))}
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Resource Usage (CPU, Memory, Disk bars + metrics)
// ---------------------------------------------------------------------------

function UsageBar({ label, percent, used, total, unit }: { label: string; percent: number; used: number; total: number; unit: string }) {
  const color = percent > 90 ? 'error' : percent > 70 ? 'warning' : 'primary';
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {used} / {total} {unit} ({percent.toFixed(1)}%)
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={Math.min(percent, 100)} color={color} sx={{ height: 8, borderRadius: 4 }} />
    </Box>
  );
}

function ServerResourceUsage({ metadata }: { readonly metadata: Record<string, unknown> | undefined }) {
  const res = ((metadata ?? {}).resourceUsage ?? {}) as Record<string, number>;

  if (!res.cpuPercent && !res.memoryPercent && !res.diskPercent) return null;

  const uptime = res.uptimeSecs ?? 0;
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const uptimeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h`;

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <MemoryIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">Resource Usage</Typography>
        {uptime > 0 && (
          <Typography variant="caption" color="text.secondary">Uptime: {uptimeStr}</Typography>
        )}
      </Stack>

      <Box sx={{ mb: 1 }}>
        <UsageBar
          label="CPU"
          percent={res.cpuPercent ?? 0}
          used={Math.round(res.cpuPercent ?? 0)}
          total={100}
          unit="%"
        />
        <UsageBar
          label="Memory"
          percent={res.memoryPercent ?? 0}
          used={res.memUsedMb ?? 0}
          total={res.memTotalMb ?? 0}
          unit="MB"
        />
        <UsageBar
          label="Disk"
          percent={res.diskPercent ?? 0}
          used={res.diskUsedGb ?? 0}
          total={res.diskTotalGb ?? 0}
          unit="GB"
        />
      </Box>

      {(res.loadAvg1 !== undefined) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Load Average: {(res.loadAvg1 ?? 0).toFixed(2)} / {(res.loadAvg5 ?? 0).toFixed(2)} / {(res.loadAvg15 ?? 0).toFixed(2)} (1m / 5m / 15m)
        </Typography>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// System Info (hardware details)
// ---------------------------------------------------------------------------

function ServerSystemInfo({ metadata }: { readonly metadata: Record<string, unknown> | undefined }) {
  const sys = ((metadata ?? {}).systemInfo ?? {}) as Record<string, unknown>;

  if (!sys.kernel && !sys.cpuCores) return null;

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <StorageIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">System Information</Typography>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 1 }}>
        {(sys.cpuCores as number) > 0 && (
          <Grid size={6}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>CPU</Typography>
            <Typography variant="body2">
              {sys.cpuCores as number} cores{(sys.cpuModel as string) ? ` — ${sys.cpuModel as string}` : ''}
            </Typography>
          </Grid>
        )}
        {(sys.totalRamMb as number) > 0 && (
          <Grid size={3}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Total RAM</Typography>
            <Typography variant="body2">{((sys.totalRamMb as number) / 1024).toFixed(1)} GB</Typography>
          </Grid>
        )}
        {(sys.totalDiskGb as number) > 0 && (
          <Grid size={3}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Total Disk</Typography>
            <Typography variant="body2">{sys.totalDiskGb as number} GB</Typography>
          </Grid>
        )}
      </Grid>
    </>
  );
}

// ---------------------------------------------------------------------------
// Agent Settings (inline in server detail)
// ---------------------------------------------------------------------------

function AgentSettings({ serverId, metadata }: { readonly serverId: string; readonly metadata: Record<string, unknown> | undefined }) {
  const updateConfig = useUpdateServerConfig();
  const config = (metadata?.config ?? {}) as Record<string, unknown>;
  const scan = (config.scan ?? {}) as Record<string, unknown>;

  const [packages, setPackages] = useState((scan.packages as boolean) ?? true);
  const [compliance, setCompliance] = useState((scan.compliance as boolean) ?? true);
  const [scanInterval, setScanInterval] = useState((scan.interval as string) ?? '6h');
  const [dirty, setDirty] = useState(false);

  // Reset when server changes
  useEffect(() => {
    setPackages((scan.packages as boolean) ?? true);
    setCompliance((scan.compliance as boolean) ?? true);
    setScanInterval((scan.interval as string) ?? '6h');
    setDirty(false);
  }, [serverId]);

  const handleSave = useCallback(() => {
    updateConfig.mutate(
      { id: serverId, scan: { packages, compliance, interval: scanInterval } },
      { onSuccess: () => setDirty(false) },
    );
  }, [serverId, packages, compliance, scanInterval, updateConfig]);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <SettingsIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">Agent Settings</Typography>
      </Stack>

      <Stack spacing={1.5} sx={{ ml: 0.5 }}>
        <FormControlLabel
          control={<Checkbox checked={packages} onChange={(e) => { setPackages(e.target.checked); setDirty(true); }} size="small" />}
          label="Scan OS packages for vulnerabilities"
        />
        <FormControlLabel
          control={<Checkbox checked={compliance} onChange={(e) => { setCompliance(e.target.checked); setDirty(true); }} size="small" />}
          label="Run CIS compliance benchmarks"
        />

        <FormControl size="small" sx={{ maxWidth: 200 }}>
          <InputLabel>Scan Interval</InputLabel>
          <Select value={scanInterval} label="Scan Interval" onChange={(e) => { setScanInterval(e.target.value); setDirty(true); }}>
            <MenuItem value="1h">Every hour</MenuItem>
            <MenuItem value="6h">Every 6 hours</MenuItem>
            <MenuItem value="12h">Every 12 hours</MenuItem>
            <MenuItem value="24h">Every 24 hours</MenuItem>
          </Select>
        </FormControl>

        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={!dirty || updateConfig.isPending}
          >
            {updateConfig.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
          {updateConfig.isSuccess && !dirty && (
            <Typography variant="caption" color="success.main">
              Saved. Changes apply within 60 seconds.
            </Typography>
          )}
          {updateConfig.isError && (
            <Typography variant="caption" color="error.main">
              Failed to save. Try again.
            </Typography>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
