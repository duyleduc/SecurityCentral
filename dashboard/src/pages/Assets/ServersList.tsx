import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Stack, Divider,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { useServers, useServer, type Server } from '../../api/hooks.js';
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
  const data = servers.data?.data as (Server & { openFindingCount?: number })[] | undefined;
  const meta = servers.data?.meta;

  if (selectedId) return <ServerDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Servers</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Hostname</TableCell>
              <TableCell>OS</TableCell>
              <TableCell>Environment</TableCell>
              <TableCell>Last Heartbeat</TableCell>
              <TableCell align="right">Findings</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {servers.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>No servers</TableCell>
              </TableRow>
            ) : data.map((s) => (
              <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
                <TableCell>
                  <FiberManualRecordIcon sx={{ fontSize: 10, color: STATUS_DOT[s.status] ?? '#6b7280' }} />
                </TableCell>
                <TableCell sx={{ fontWeight: 500 }}>{s.hostname}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{s.osFamily} {s.osVersion}</TableCell>
                <TableCell>
                  <Chip label={s.environment} size="small" color={ENV_COLOR[s.environment] ?? 'default'} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{relativeTime(s.lastHeartbeat)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 500 }}>{s.openFindingCount ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </Box>
  );
}

function ServerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useServer(id);
  const server = envelope?.data as Record<string, unknown> | undefined;

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

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" onClick={onBack} sx={{ mb: 2 }}>
        Back to Servers
      </Button>
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
              <Grid item xs={4} key={label}>
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
