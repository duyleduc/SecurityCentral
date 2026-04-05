import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Chip, Stack,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Alert,
} from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { useServers, useAgentVersion, type Server } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';

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
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const servers = useServers({ page, per_page: 25 });
  const { data: versionInfo } = useAgentVersion();
  const data = servers.data?.data as Server[] | undefined;
  const meta = servers.data?.meta;

  const latestVersion = versionInfo?.version ?? '';
  const outdatedCount = data?.filter((s) => s.agentVersion && s.agentVersion !== latestVersion).length ?? 0;

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
              <TableCell>Tags</TableCell>
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
                <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/assets/servers/${s.id}`)}>
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
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {Object.entries(s.tags ?? {}).map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{relativeTime(s.lastHeartbeat ?? undefined)}</TableCell>
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
