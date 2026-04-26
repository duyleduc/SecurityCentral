import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Stack,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import { useDashboardSummary, useDashboardTopRisks, useDashboardAssets } from '../../api/hooks';
import { ScoreBadge } from '../../components/ScoreBadge';
import { HealthChip, WorkStateChip } from '../../components/status';
import { ScopeBanner } from '../../components/ScopeBanner';
import { useProjectScope } from '../../lib/useProjectScope';
import { healthFromServerStatus, healthFromDomainStatus, workStateFromFindingStatus } from '../../lib/status';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};

function assetLabel(asset: { type: string; [key: string]: unknown }): string {
  if (asset.type === 'repository') {
    const owner = asset.owner as string | undefined;
    const name = asset.name as string | undefined;
    if (owner && name) return `${owner}/${name}`;
    return (name as string) ?? 'Repository';
  }
  if (asset.type === 'server') {
    return (asset.hostname as string) ?? 'Server';
  }
  if (asset.type === 'endpoint') {
    return (asset.host as string) ?? 'Domain';
  }
  return 'Asset';
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardOverviewPage() {
  const navigate = useNavigate();
  const { projectId } = useProjectScope();
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: topRisks, isLoading: risksLoading } = useDashboardTopRisks();
  const { data: assets } = useDashboardAssets();

  const scoped = useMemo(() => {
    if (!projectId) {
      return { topRisks: topRisks ?? [], assets: assets ?? [] };
    }
    // Client-side filter: the dashboard endpoints don't yet accept ?project=,
    // so we narrow by projectId on any asset that carries one. Aggregate counts
    // (summary.findings, summary.assets, summary.score) remain org-wide for now.
    const filteredRisks = (topRisks ?? []).filter((f) => {
      const repoProject = (f as { repository?: { projectId?: string | null } }).repository?.projectId;
      const serverProject = (f as { server?: { projectId?: string | null } }).server?.projectId;
      return repoProject === projectId || serverProject === projectId;
    });
    const filteredAssets = (assets ?? []).filter((a) => {
      return (a as { projectId?: string | null }).projectId === projectId;
    });
    return { topRisks: filteredRisks, assets: filteredAssets };
  }, [topRisks, assets, projectId]);

  if (summaryLoading) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const findings = summary?.findings;
  const score = summary?.score;
  const assetCounts = summary?.assets;

  return (
    <Box>
      {/* Greeting */}
      <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 0.5 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          {greeting()}.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Here's what needs you today.
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2.5 }}>
        {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </Typography>

      {/* Scope banner — appears when a project is selected in the top-bar switcher */}
      <ScopeBanner
        summary={
          projectId
            ? 'Project-scoped view — asset counts below remain org-wide until backend support lands'
            : undefined
        }
      />

      {/* Score + severity counters row */}
      <Grid container spacing={3} mb={3}>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 3 }}>
              <ScoreBadge
                score={score?.score ?? 100}
                breakdown={score?.breakdown}
                size="large"
              />
              <Typography variant="body2" color="text.secondary" mt={1}>
                Security Score
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
          <Grid key={sev} size={{ xs: 6, sm: 2.25 }}>
            <Card sx={{ height: '100%' }}>
              <CardActionArea onClick={() => navigate(`/findings`)}>
                <CardContent>
                  <Typography variant="h3" sx={{ color: SEVERITY_COLORS[sev], fontWeight: 700 }}>
                    {findings?.[sev] ?? 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {sev}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Asset counts row — clickable to navigate to each list page */}
      <Grid container spacing={3} mb={3}>
        {([
          { label: 'Projects', value: assetCounts?.projects ?? 0, icon: <FolderIcon sx={{ fontSize: 36 }} />, to: '/projects' },
          { label: 'Repositories', value: assetCounts?.repositories ?? 0, icon: <CodeIcon sx={{ fontSize: 36 }} />, to: '/repositories' },
          { label: 'Servers', value: assetCounts?.servers ?? 0, icon: <StorageIcon sx={{ fontSize: 36 }} />, to: '/servers' },
          { label: 'Domains', value: assetCounts?.domains ?? 0, icon: <DnsIcon sx={{ fontSize: 36 }} />, to: '/domains' },
        ]).map((s) => (
          <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardActionArea onClick={() => navigate(s.to)}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ color: 'primary.main' }}>{s.icon}</Box>
                  <Box>
                    <Typography variant="h4">{s.value}</Typography>
                    <Typography variant="body2" color="text.secondary">{s.label}</Typography>
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Top Risks — matches mockup with Health chip for asset + WorkState chip */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h5">🔥 Top risks</Typography>
        <Typography variant="caption" color="text.secondary">
          Auto-refreshes every 15s
        </Typography>
      </Stack>
      <Card sx={{ mb: 4 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Asset</TableCell>
                <TableCell>Risk</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Work state</TableCell>
                <TableCell>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {risksLoading ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={20} />
                  </TableCell>
                </TableRow>
              ) : !scoped.topRisks?.length ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    {projectId
                      ? 'No top risks in this project.'
                      : 'No critical or high findings. 🎉'}
                  </TableCell>
                </TableRow>
              ) : (
                scoped.topRisks.map((f) => {
                  // Derive a rough asset-level health from the finding's severity — cheap proxy.
                  const assetHealth =
                    f.severity === 'critical' ? 'critical' :
                    f.severity === 'high' ? 'at-risk' :
                    f.severity === 'medium' ? 'at-risk' : 'healthy';
                  const assetLabelText = f.repository
                    ? `${f.repository.owner}/${f.repository.name}`
                    : f.server
                      ? f.server.hostname
                      : '—';
                  return (
                    <TableRow
                      key={f.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/findings/${f.id}`)}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <HealthChip health={assetHealth} dense />
                          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                            {assetLabelText}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 350 }}>
                          {f.title}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={f.severity}
                          size="small"
                          sx={{
                            bgcolor: SEVERITY_COLORS[f.severity] ?? '#6b7280',
                            color: '#fff',
                            fontWeight: 600,
                            textTransform: 'capitalize',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <WorkStateChip state={workStateFromFindingStatus(f.status)} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                          {new Date(f.createdAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Asset Scores — health chip next to each */}
      {scoped.assets.length > 0 && (
        <>
          <Typography variant="h5" mb={2}>
            Asset Scores
          </Typography>
          <Grid container spacing={3}>
            {scoped.assets.map((a) => {
              const rawStatus = (a as { status?: string }).status;
              let health: 'healthy' | 'at-risk' | 'critical' | 'unknown' | null = null;
              if (a.type === 'server') health = healthFromServerStatus(rawStatus);
              else if (a.type === 'endpoint') health = healthFromDomainStatus(rawStatus);
              else if (a.type === 'repository') {
                // Proxy: derive from score
                health = a.score.score >= 80 ? 'healthy' : a.score.score >= 60 ? 'at-risk' : 'critical';
              }
              return (
                <Grid key={a.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card>
                    <CardActionArea
                      onClick={() => {
                        if (a.type === 'server') navigate(`/servers/${a.id}`);
                        else if (a.type === 'endpoint') navigate(`/domains/${a.id}`);
                        else if (a.type === 'repository') navigate(`/repositories/${a.id}`);
                      }}
                    >
                      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <ScoreBadge
                          score={a.score.score}
                          breakdown={a.score.breakdown}
                          size="medium"
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body1" fontWeight={600} noWrap>
                            {assetLabel(a)}
                          </Typography>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                              {a.type}
                            </Typography>
                            {health && (
                              <>
                                <Typography variant="caption" color="text.secondary">·</Typography>
                                <HealthChip health={health} />
                              </>
                            )}
                          </Stack>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}
    </Box>
  );
}
