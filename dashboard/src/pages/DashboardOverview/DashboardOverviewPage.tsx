import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, Grid, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, CircularProgress, Stack,
} from '@mui/material';
import BugReportIcon from '@mui/icons-material/BugReport';
import LockIcon from '@mui/icons-material/Lock';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import CodeIcon from '@mui/icons-material/Code';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useDashboardSummary, useDashboardTopRisks, useDashboardAssets } from '../../api/hooks';
import { ScopeBanner } from '../../components/ScopeBanner';
import { ScoreRing, SectionCard, AlertRow, StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
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
  const { user } = useAuth();
  // Use the first word of the full name as the friendly greeting form.
  // Fall back to the local-part of the email if name is missing (older sessions).
  const firstName = (user?.name?.trim().split(/\s+/)[0])
    || user?.email?.split('@')[0]
    || '';
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
      <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 0.5 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h4">
          {greeting()}{firstName ? `, ${firstName}` : ''}.
        </Typography>
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

      {/* Hero row — security score + asset summaries */}
      <Grid container spacing={2} mb={3}>
        {/* Security score — distinct hero card with the conic ring */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ p: 2, height: '100%' }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <ScoreRing score={score} size={64} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Security score
                </Typography>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.25 }}>
                  <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{score}</Typography>
                  <Chip label={grade.letter} size="small" color={grade.color} sx={{ fontWeight: 700, height: 20, '& .MuiChip-label': { px: 0.75 } }} />
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.25 }}>
                  {findings?.total ?? 0} open finding{findings?.total === 1 ? '' : 's'}
                </Typography>
              </Box>
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AssetCard
            icon={<StorageIcon />}
            iconColor="#22c55e"
            label="Servers"
            total={counts?.servers ?? 0}
            stats={[
              { label: 'healthy', value: healthyServers, color: '#22c55e' },
              { label: 'at-risk', value: atRiskServers, color: '#f59e0b' },
            ]}
            onClick={() => scopedNavigate('/servers')}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AssetCard
            icon={<DnsIcon />}
            iconColor={criticalEndpoints > 0 ? '#ef4444' : '#22c55e'}
            label="Domains"
            total={counts?.domains ?? 0}
            stats={[
              { label: 'healthy', value: healthyEndpoints, color: '#22c55e' },
              { label: 'critical', value: criticalEndpoints, color: '#ef4444' },
            ]}
            onClick={() => scopedNavigate('/domains')}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AssetCard
            icon={<CodeIcon />}
            iconColor={reposNeedingAttention > 0 ? '#f59e0b' : '#22c55e'}
            label="Repositories"
            total={counts?.repositories ?? 0}
            stats={[
              { label: 'need attention', value: reposNeedingAttention, color: '#f59e0b' },
              { label: 'healthy', value: (counts?.repositories ?? 0) - reposNeedingAttention, color: '#22c55e' },
            ]}
            onClick={() => scopedNavigate('/repositories')}
          />
        </Grid>
      </Grid>

      {/* Severity strip — icon-led tiles, clickable filters into Findings */}
      <Grid container spacing={2} mb={3}>
        {([
          { sev: 'critical' as const, label: 'Critical', icon: <ErrorOutlineIcon />,        color: '#ef4444' },
          { sev: 'high' as const,     label: 'High',     icon: <ReportProblemIcon />,       color: '#f59e0b' },
          { sev: 'medium' as const,   label: 'Medium',   icon: <InfoOutlinedIcon />,        color: '#22d3ee' },
          { sev: 'low' as const,      label: 'Low',      icon: <RemoveCircleOutlineIcon />, color: '#94a3b8' },
        ]).map((s) => (
          <Grid key={s.sev} size={{ xs: 6, sm: 3 }}>
            <SeverityTile
              icon={s.icon}
              color={s.color}
              label={s.label}
              count={findings?.[s.sev] ?? 0}
              onClick={() => scopedNavigate(`/findings?severity=${s.sev}`)}
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

// ---------------------------------------------------------------------------
// AssetCard — icon avatar + total count + per-status mini stats.
// Used for Servers / Domains / Repos on the dashboard hero row.
// ---------------------------------------------------------------------------

interface AssetCardProps {
  icon: ReactNode;
  iconColor: string;
  label: string;
  total: number;
  stats: Array<{ label: string; value: number; color: string }>;
  onClick?: () => void;
}

function AssetCard({ icon, iconColor, label, total, stats, onClick }: AssetCardProps) {
  return (
    <Card
      onClick={onClick}
      sx={{
        p: 2, height: '100%', cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, transform 0.15s',
        '&:hover': onClick ? { borderColor: `${iconColor}55` } : undefined,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} mb={1.25}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 1.5, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${iconColor}1f`,
          color: iconColor,
          '& svg': { fontSize: 22 },
        }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
            {total}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        {stats.map((s) => (
          <Stack key={s.label} direction="row" alignItems="center" spacing={0.5}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: s.color }} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              <Box component="span" sx={{ color: s.color, fontWeight: 600 }}>{s.value}</Box>{' '}{s.label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SeverityTile — icon + count + label, severity-coloured.
// ---------------------------------------------------------------------------

interface SeverityTileProps {
  icon: ReactNode;
  color: string;
  label: string;
  count: number;
  onClick?: () => void;
}

function SeverityTile({ icon, color, label, count, onClick }: SeverityTileProps) {
  return (
    <Card
      onClick={onClick}
      sx={{
        p: 1.75, height: '100%', cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
        '&:hover': onClick ? { borderColor: `${color}55` } : undefined,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 1.5, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${color}1f`, color,
          '& svg': { fontSize: 20 },
        }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.1 }}>
            {count}
          </Typography>
        </Box>
      </Stack>
    </Card>
  );
}
