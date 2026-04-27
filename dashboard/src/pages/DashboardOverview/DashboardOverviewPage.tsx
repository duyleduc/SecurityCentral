import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Grid, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Stack,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import LockIcon from '@mui/icons-material/Lock';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useDashboardSummary, useDashboardTopRisks, useDashboardAssets } from '../../api/hooks';
import { ScopeBanner } from '../../components/ScopeBanner';
import { ScoreRing, StatCard, SectionCard, AlertRow, StatusDot } from '../../components/design';
import { useProjectScope, useScopedNavigate } from '../../lib/useProjectScope';
import { workStateFromFindingStatus } from '../../lib/status';
import { WorkStateChip } from '../../components/status';

const SEVERITY_COLOURS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#22d3ee',
  low: '#94a3b8',
  info: '#94a3b8',
};

function gradeLetter(score: number): { letter: string; color: 'success' | 'warning' | 'error' } {
  if (score >= 90) return { letter: 'A', color: 'success' };
  if (score >= 80) return { letter: 'B', color: 'success' };
  if (score >= 70) return { letter: 'C', color: 'warning' };
  if (score >= 60) return { letter: 'D', color: 'warning' };
  return { letter: 'F', color: 'error' };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DashboardOverviewPage() {
  const navigate = useNavigate();
  const scopedNavigate = useScopedNavigate();
  const { projectId } = useProjectScope();
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary(projectId);
  const { data: topRisks, isLoading: risksLoading } = useDashboardTopRisks(projectId);
  const { data: assets } = useDashboardAssets(projectId);

  const scoped = useMemo(() => ({
    topRisks: Array.isArray(topRisks) ? topRisks : [],
    assets: Array.isArray(assets) ? assets : [],
  }), [topRisks, assets]);

  if (summaryLoading) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const score = summary?.score?.score ?? 100;
  const findings = summary?.findings;
  const counts = summary?.assets;
  const grade = gradeLetter(score);

  // Build "recent activity" feed from top risks (mockup .alert-row layout).
  const recent = (scoped.topRisks ?? []).slice(0, 5);

  // Categorise asset health from server statuses we can read on the dashboard.
  const serverAssets = scoped.assets.filter((a) => a.type === 'server');
  const healthyServers = serverAssets.filter((a) => (a as { status?: string }).status === 'online').length;
  const atRiskServers = serverAssets.filter((a) => {
    const s = (a as { status?: string }).status;
    return s === 'warning' || s === 'critical';
  }).length;

  const endpointAssets = scoped.assets.filter((a) => a.type === 'endpoint');
  const healthyEndpoints = endpointAssets.filter((a) => (a as { status?: string }).status === 'healthy').length;
  const criticalEndpoints = endpointAssets.filter((a) => (a as { status?: string }).status === 'down').length;

  const repoFindings = (scoped.assets.filter((a) => a.type === 'repository') ?? []);
  const reposNeedingAttention = repoFindings.filter((a) => a.score.score < 75).length;

  return (
    <Box>
      {/* Greeting */}
      <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 0.5 }}>
        <Typography variant="h4">{greeting()}.</Typography>
        <Typography variant="body2" color="text.secondary">
          Here's what needs you today.
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2.5 }}>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </Typography>

      <ScopeBanner
        summary={projectId
          ? `Project-scoped view — ${counts?.servers ?? 0} servers · ${counts?.domains ?? 0} domains · ${counts?.repositories ?? 0} repos`
          : undefined}
      />

      {/* Score + asset stat cards */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3, alignItems: 'stretch' }}>
        {/* Score card */}
        <Box sx={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2,
          background: 'rgba(15, 23, 42, 0.7)', border: '1px solid', borderColor: 'divider',
          borderRadius: 2, px: 2.5, py: 2,
        }}>
          <ScoreRing score={score} />
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Security score
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{score}</Typography>
              <Chip label={grade.letter} size="small" color={grade.color} sx={{ fontWeight: 700 }} />
            </Stack>
            <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.25 }}>
              {findings?.total ?? 0} open findings
            </Typography>
          </Box>
        </Box>

        <StatCard
          value={healthyServers}
          label={`Healthy servers · ${atRiskServers} at-risk`}
          color="success"
          onClick={() => scopedNavigate('/servers')}
        />
        <StatCard
          value={healthyEndpoints}
          label={`Healthy domains · ${criticalEndpoints} critical`}
          color={criticalEndpoints > 0 ? 'warning' : 'success'}
          onClick={() => scopedNavigate('/domains')}
        />
        <StatCard
          value={reposNeedingAttention}
          label="Repos need attention"
          color={reposNeedingAttention > 0 ? 'warning' : 'success'}
          onClick={() => scopedNavigate('/repositories')}
        />
      </Stack>

      {/* Severity strip — clickable filters into Findings */}
      <Grid container spacing={2} mb={3}>
        {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
          <Grid key={sev} size={{ xs: 6, sm: 3 }}>
            <StatCard
              value={findings?.[sev] ?? 0}
              label={sev.charAt(0).toUpperCase() + sev.slice(1)}
              color={sev === 'critical' ? 'error' : sev === 'high' ? 'warning' : sev === 'medium' ? 'info' : 'muted'}
              onClick={() => scopedNavigate(`/findings?severity=${sev}`)}
            />
          </Grid>
        ))}
      </Grid>

      {/* Top risks table */}
      <Box sx={{ mb: 3 }}>
        <SectionCard
          title="Top risks"
          action={<Typography variant="caption" color="text.secondary">Auto-refreshes every 15s</Typography>}
        >
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Asset</TableCell>
                  <TableCell>Risk</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>Work state</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {risksLoading ? (
                  <TableRow><TableCell colSpan={4} sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={20} /></TableCell></TableRow>
                ) : scoped.topRisks.length === 0 ? (
                  <TableRow><TableCell colSpan={4} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    {projectId ? 'No top risks in this project.' : 'No critical or high findings. 🎉'}
                  </TableCell></TableRow>
                ) : (
                  scoped.topRisks.map((f) => {
                    const assetHealth: 'error' | 'warning' | 'success' = f.severity === 'critical' ? 'error'
                      : f.severity === 'high' || f.severity === 'medium' ? 'warning' : 'success';
                    const stateLabel: 'critical' | 'at-risk' | 'healthy' = assetHealth === 'error' ? 'critical'
                      : assetHealth === 'warning' ? 'at-risk' : 'healthy';
                    const assetLabel = f.repository ? `${f.repository.owner}/${f.repository.name}`
                      : f.server ? f.server.hostname : '—';
                    return (
                      <TableRow key={f.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/findings/${f.id}`)}>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              size="small"
                              icon={<StatusDot color={assetHealth === 'error' ? 'error' : assetHealth === 'warning' ? 'warning' : 'success'} />}
                              label={stateLabel}
                              sx={{
                                bgcolor: assetHealth === 'error' ? 'rgba(239, 68, 68, 0.15)'
                                  : assetHealth === 'warning' ? 'rgba(245, 158, 11, 0.15)'
                                  : 'rgba(34, 197, 94, 0.15)',
                                color: assetHealth === 'error' ? '#fca5a5'
                                  : assetHealth === 'warning' ? '#fcd34d' : '#86efac',
                              }}
                            />
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{assetLabel}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 380 }}>{f.title}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={f.severity} size="small"
                            sx={{ bgcolor: `${SEVERITY_COLOURS[f.severity]}26`, color: SEVERITY_COLOURS[f.severity], fontWeight: 600, textTransform: 'capitalize' }} />
                        </TableCell>
                        <TableCell>
                          <WorkStateChip state={workStateFromFindingStatus(f.status)} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionCard>
      </Box>

      {/* Recent activity */}
      <SectionCard title="Recent activity">
        {recent.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No recent activity.</Typography>
        ) : (
          recent.map((f) => {
            const isCert = (f.source ?? '').includes('cert');
            const isCritical = f.severity === 'critical';
            return (
              <AlertRow
                key={f.id}
                icon={isCritical ? <WarningAmberIcon fontSize="small" /> : isCert ? <LockIcon fontSize="small" /> : <BugReportIcon fontSize="small" />}
                iconColor={isCritical ? 'critical' : isCert ? 'warning' : 'primary'}
                title={f.title}
                sub={`${timeAgo(f.createdAt)} · ${f.source.replace(/_/g, ' ')}`}
                onClick={() => navigate(`/findings/${f.id}`)}
              />
            );
          })
        )}
      </SectionCard>
    </Box>
  );
}
