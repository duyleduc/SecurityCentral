import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, CardActionArea, Grid, Button, Chip, Stack, Alert, TextField,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Tabs, Tab, Select, MenuItem, IconButton, Tooltip, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import { useEndpoints, useCreateEndpoint, useDeleteEndpoint, useTriggerCheck, useProjects, useTagKeys } from '../../api/hooks';
import { useRealtimeHeartbeat } from '../../ws/useRealtimeHeartbeat';
import { TagsInput, type Tag } from '../../components/TagsInput';
import { HealthChip, OpStateChip } from '../../components/status';
import { ScopeBanner } from '../../components/ScopeBanner';
import { StatCard } from '../../components/design';
import { useProjectScope } from '../../lib/useProjectScope';
import { healthFromDomainStatus, opStateFromDomainStatus, type Health } from '../../lib/status';

/** Domain backend status → the status dot color used in the list table. */
const DOT_COLOR: Record<string, string> = {
  healthy: '#16a34a',
  degraded: '#d97706',
  down: '#dc2626',
  pending: '#9e9e9e',
};

/** Map our normalized Health to a backend `status` query value. */
const HEALTH_TO_STATUS_QUERY: Record<Health, string | undefined> = {
  healthy: 'healthy',
  'at-risk': 'degraded',
  critical: 'down',
  unknown: 'pending',
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DomainsPage() {
  const { projectId: scopedProjectId } = useProjectScope();
  const [healthFilter, setHealthFilter] = useState<Health | null>(null);
  const [tagQuery, setTagQuery] = useState('');
  const [tagInput, setTagInput] = useState('');

  const filters = {
    status: healthFilter ? HEALTH_TO_STATUS_QUERY[healthFilter] : undefined,
    tags: tagQuery || undefined,
    projectId: scopedProjectId || undefined,
  };
  const { data: endpoints, isLoading } = useEndpoints(filters);
  const { data: projects } = useProjects();
  const createEndpoint = useCreateEndpoint();
  const deleteEndpoint = useDeleteEndpoint();
  const triggerCheck = useTriggerCheck();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; host: string } | null>(null);

  // Subscribe to real-time heartbeat updates
  useRealtimeHeartbeat();

  // Unfiltered counts for the summary cards — tag + project filters still apply,
  // so the health distribution reflects the current scope.
  const { data: allEndpointsForCounts } = useEndpoints({
    tags: tagQuery || undefined,
    projectId: scopedProjectId || undefined,
  });
  const healthyCount  = allEndpointsForCounts?.filter((e) => healthFromDomainStatus(e.status) === 'healthy').length ?? 0;
  const atRiskCount   = allEndpointsForCounts?.filter((e) => healthFromDomainStatus(e.status) === 'at-risk').length ?? 0;
  const criticalCount = allEndpointsForCounts?.filter((e) => healthFromDomainStatus(e.status) === 'critical').length ?? 0;
  const unknownCount  = allEndpointsForCounts?.filter((e) => healthFromDomainStatus(e.status) === 'unknown').length ?? 0;
  const hasFilters = !!healthFilter || !!tagQuery;

  const toggleHealth = (h: Health) => {
    setHealthFilter((prev) => (prev === h ? null : h));
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4">Domain Monitoring</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor TLS certificates and endpoint reachability
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowAdd(!showAdd)}>
          Add Domains
        </Button>
      </Stack>

      <ScopeBanner summary={`${allEndpointsForCounts?.length ?? 0} endpoints in scope`} />

      {/* Summary cards — click to filter by health, click again to clear */}
      <Grid container spacing={2} mb={3}>
        {([
          { label: '● Healthy',  value: healthyCount,  color: 'success' as const, health: 'healthy'  as Health },
          { label: '● At-risk',  value: atRiskCount,   color: 'warning' as const, health: 'at-risk'  as Health },
          { label: '● Critical', value: criticalCount, color: 'error'   as const, health: 'critical' as Health },
          { label: '○ Unknown',  value: unknownCount,  color: 'muted'   as const, health: 'unknown'  as Health },
        ]).map((s) => {
          const active = healthFilter === s.health;
          return (
            <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
              <StatCard
                value={s.value}
                label={active ? `${s.label} · filtering` : s.label}
                color={s.color}
                active={active}
                onClick={() => toggleHealth(s.health)}
              />
            </Grid>
          );
        })}
      </Grid>

      {/* Filters — project filter removed; scope is global via top-bar switcher */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <FilterListIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
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
          sx={{ width: 280 }}
        />
        {tagInput && tagInput !== tagQuery && (
          <Button size="small" variant="outlined" onClick={() => setTagQuery(tagInput)}>
            Apply
          </Button>
        )}
        {hasFilters && (
          <Chip label="Clear filters" size="small" variant="outlined" onDelete={() => { setHealthFilter(null); setTagQuery(''); setTagInput(''); }} />
        )}
      </Stack>

      {showAdd && <AddDomainsForm projects={projects ?? []} onDone={() => setShowAdd(false)} />}

      {/* Endpoint table */}
      <TableContainer component={Paper}>
        {isLoading ? (
          <Box sx={{ p: 5 }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="text" sx={{ mb: 1 }} />)}
          </Box>
        ) : !endpoints?.length ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <LockIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>No domains monitored</Typography>
            <Typography variant="body2" color="text.secondary">Add domains to start monitoring</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 30 }} />
                <TableCell>Endpoint</TableCell>
                <TableCell align="center">Health</TableCell>
                <TableCell align="center">Op state</TableCell>
                <TableCell align="center">SSL</TableCell>
                <TableCell>Last checked</TableCell>
                <TableCell align="right">Response</TableCell>
                <TableCell sx={{ width: 100 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {endpoints.map((ep) => {
                const dotColor = DOT_COLOR[ep.status] ?? DOT_COLOR.pending;
                const lastHb = ep.heartbeats?.[0];
                const ssl = ep.latestSsl;

                return (
                  <TableRow
                    key={ep.id} hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/domains/${ep.id}`)}
                  >
                    <TableCell>
                      <FiberManualRecordIcon sx={{ fontSize: 10, color: dotColor }} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="body2" fontWeight={500}>{ep.host}</Typography>
                          {ep.port !== 443 && (
                            <Typography variant="caption" color="text.secondary">:{ep.port}</Typography>
                          )}
                        </Box>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap onClick={(e) => e.stopPropagation()}>
                          {ep.project && (
                            <Chip
                              label={ep.project.name}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem' }}
                            />
                          )}
                          {ep.tags?.map((t) => {
                            const filterExpr = t.value ? `${t.key}=${t.value}` : t.key;
                            const chipLabel = t.value ? `${t.key}:${t.value}` : t.key;
                            return (
                              <Chip
                                key={t.key}
                                label={chipLabel}
                                size="small"
                                clickable
                                onClick={() => { setTagInput(filterExpr); setTagQuery(filterExpr); }}
                                sx={{ fontSize: '0.65rem', height: 20, bgcolor: 'action.selected', cursor: 'pointer' }}
                              />
                            );
                          })}
                        </Stack>
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <HealthChip health={healthFromDomainStatus(ep.status)} />
                    </TableCell>
                    <TableCell align="center">
                      <OpStateChip state={opStateFromDomainStatus(ep.status)} />
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
                        <SslGradeBadge grade={ssl?.sslGrade} gradeColor={ssl?.sslGradeColor} daysLeft={ssl?.sslDaysLeft} valid={ssl?.sslValid} />
                        {ssl?.sslDaysLeft != null && (
                          <Chip
                            label={`${ssl.sslDaysLeft}d`}
                            size="small"
                            variant="outlined"
                            sx={{
                              fontSize: '0.65rem',
                              height: 18,
                              borderColor: ssl.sslDaysLeft <= 7 ? 'error.main' : ssl.sslDaysLeft <= 30 ? 'warning.main' : 'divider',
                              color: ssl.sslDaysLeft <= 7 ? 'error.main' : ssl.sslDaysLeft <= 30 ? 'warning.main' : 'text.secondary',
                            }}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                      {relativeTime(ep.lastCheckAt)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {lastHb?.responseMs != null ? `${lastHb.responseMs}ms` : '--'}
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Check now">
                          <IconButton size="small" onClick={() => triggerCheck.mutate(ep.id)} disabled={triggerCheck.isPending}>
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove">
                          <IconButton
                            size="small"
                            onClick={() => setDeleteTarget({ id: ep.id, host: ep.host })}
                            sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Remove confirmation dialog */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Domain</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to remove <strong>{deleteTarget?.host}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            All heartbeat history for this endpoint will be deleted. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="contained" color="error"
            onClick={() => { deleteEndpoint.mutate(deleteTarget!.id); setDeleteTarget(null); }}
            disabled={deleteEndpoint.isPending}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SSL Grade Badge — shows actual grade from scan
// ---------------------------------------------------------------------------

function SslGradeBadge({ grade, gradeColor, daysLeft, valid }: {
  grade?: string | null; gradeColor?: string | null; daysLeft?: number | null; valid?: boolean | null;
}) {
  if (!grade) {
    return (
      <Tooltip title="No SSL scan yet">
        <Typography variant="caption" color="text.disabled">--</Typography>
      </Tooltip>
    );
  }

  const color = gradeColor ?? '#9e9e9e';
  const tooltip = valid === false
    ? 'Invalid certificate'
    : daysLeft != null && daysLeft <= 0
      ? 'Certificate expired'
      : daysLeft != null
        ? `${daysLeft} days remaining`
        : grade;

  return (
    <Tooltip title={tooltip}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: '50%',
        bgcolor: color, color: '#fff',
        fontWeight: 800, fontSize: '0.7rem',
        boxShadow: `0 0 0 3px ${color}22`,
      }}>
        {grade}
      </Box>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Add Domains Form — single + bulk tabs
// ---------------------------------------------------------------------------

function AddDomainsForm({ projects, onDone }: { projects: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [bulkText, setBulkText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [interval, setInterval] = useState(15);
  const [timeout, setTimeout] = useState(30);
  const [tags, setTags] = useState<Tag[]>([]);
  const createEndpoint = useCreateEndpoint();
  const { data: existingKeys } = useTagKeys(projectId || undefined);
  const [result, setResult] = useState<{ count: number; error?: string } | null>(null);

  const handleSubmit = async () => {
    setResult(null);
    const hosts = mode === 'single'
      ? [{ host: host.trim(), port: parseInt(port, 10) || 443 }]
      : bulkText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [h, p] = l.split(':');
          return { host: h.trim(), port: parseInt(p, 10) || 443 };
        });

    if (hosts.length === 0) return;

    let created = 0;
    for (const h of hosts) {
      try {
        await createEndpoint.mutateAsync({
          host: h.host,
          port: h.port,
          projectId: projectId || undefined,
          uptimeInterval: interval,
          uptimeTimeout: timeout,
          tags: tags.length > 0 ? tags : undefined,
        });
        created++;
      } catch (err) {
        setResult({ count: created, error: (err as Error).message });
        return;
      }
    }
    setResult({ count: created });
    setHost(''); setPort('443'); setBulkText('');
  };

  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
          <Tabs value={mode === 'single' ? 0 : 1} onChange={(_, v) => setMode(v === 0 ? 'single' : 'bulk')}>
            <Tab label="Single" />
            <Tab label="Bulk" />
          </Tabs>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: 'auto' }}>
            <TextField size="small" type="number" label="Interval (s)" value={interval}
              onChange={(e) => setInterval(Number(e.target.value))} sx={{ width: 100 }}
              inputProps={{ min: 5, max: 3600 }} />
            <TextField size="small" type="number" label="Timeout (s)" value={timeout}
              onChange={(e) => setTimeout(Number(e.target.value))} sx={{ width: 100 }}
              inputProps={{ min: 5, max: 120 }} />
          </Stack>
        </Stack>

        {mode === 'single' ? (
          <Stack direction="row" spacing={1}>
            <TextField size="small" fullWidth placeholder="example.com" value={host}
              onChange={(e) => setHost(e.target.value)} />
            <TextField size="small" placeholder="443" value={port}
              onChange={(e) => setPort(e.target.value)} sx={{ width: 90 }} />
          </Stack>
        ) : (
          <Box>
            <TextField size="small" fullWidth multiline rows={4}
              placeholder={"example.com\napi.example.com:443\ninternal.corp.net:8443"}
              value={bulkText} onChange={(e) => setBulkText(e.target.value)}
              sx={{ fontFamily: 'monospace' }} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              One per line. Format: host or host:port (default 443)
            </Typography>
          </Box>
        )}

        {projects.length > 0 && (
          <FormControl size="small" sx={{ mt: 1.5, minWidth: 200 }}>
            <InputLabel>Project (optional)</InputLabel>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} label="Project (optional)">
              <MenuItem value="">None</MenuItem>
              {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
        )}

        <Box sx={{ mt: 1.5 }}>
          <TagsInput tags={tags} onChange={setTags} existingKeys={existingKeys ?? []} />
        </Box>

        {result && (
          <Alert severity={result.error ? 'warning' : 'success'} sx={{ mt: 1.5 }} onClose={() => setResult(null)}>
            {result.count > 0 && <span>{result.count} endpoint(s) added. </span>}
            {result.error && <span>{result.error}</span>}
          </Alert>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button variant="outlined" onClick={onDone}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit}
            disabled={createEndpoint.isPending || (mode === 'single' ? !host.trim() : !bulkText.trim())}>
            {createEndpoint.isPending ? 'Adding...' : 'Add'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
