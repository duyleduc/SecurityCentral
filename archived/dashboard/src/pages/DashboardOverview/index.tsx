import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboardSummary, useDashboardTopRisks, useDashboardAssets, useFindingsTrends } from '../../api/hooks.js';
import { subscribe } from '../../ws/index.js';
import { SEVERITY_COLORS } from '../../theme/theme.js';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { Link } from 'react-router-dom';

export function DashboardOverview() {
  const summary = useDashboardSummary();
  const topRisks = useDashboardTopRisks();
  const assets = useDashboardAssets();
  const trends = useFindingsTrends({ interval: 'day', days: 30 });
  const qc = useQueryClient();
  const [view, setView] = useState<'operator' | 'executive'>('operator');

  useEffect(() => {
    const unsubs = [
      subscribe('finding:new', () => { qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] }); qc.invalidateQueries({ queryKey: ['dashboard', 'top-risks'] }); }),
      subscribe('finding:resolved', () => { qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] }); }),
      subscribe('scan:completed', () => { qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['findings', 'trends'] }); }),
      subscribe('agent:disconnected', () => { qc.invalidateQueries({ queryKey: ['dashboard', 'assets'] }); }),
      subscribe('cert:expiring', () => { qc.invalidateQueries({ queryKey: ['dashboard', 'assets'] }); }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  const findingsData = (summary.data?.data as any)?.findings;
  const assetsData = assets.data?.data as any;
  const topRisksData = (topRisks.data?.data ?? []) as any[];
  const trendsData = trends.data?.data as any;

  const planLimits = { servers: 25, repos: 20, certs: 50 };
  const usage = {
    servers: assetsData?.servers?.total ?? 0,
    repos: assetsData?.repositories?.total ?? 0,
    certs: assetsData?.certificates?.total ?? 0,
  };

  const riskSources = useMemo(() => {
    const counts: Record<string, number> = {};
    topRisksData.forEach((f) => {
      const src = f.source ?? 'unknown';
      counts[src] = (counts[src] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
  }, [topRisksData]);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ mb: 0.5 }}>General View</Typography>
          <Typography variant="body2" color="text.secondary">
            A decision-first snapshot of what matters most right now.
          </Typography>
        </Box>
        <ToggleButtonGroup
          size="small"
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          sx={{ bgcolor: '#ffffff', border: '1px solid rgba(11, 19, 32, 0.08)', borderRadius: 2 }}
        >
          <ToggleButton value="operator" sx={{ textTransform: 'none' }}>Operator</ToggleButton>
          <ToggleButton value="executive" sx={{ textTransform: 'none' }}>Executive</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {/* Summary row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Critical risks', value: findingsData?.by_severity?.critical ?? 0, color: '#dc2626' },
          { label: 'Expiring certs', value: assetsData?.certificates?.affected ?? 0, color: '#f59e0b' },
          { label: 'Servers at risk', value: assetsData?.servers?.affected ?? 0, color: '#ea580c' },
          { label: 'Repos with risks', value: assetsData?.repositories?.affected ?? 0, color: '#0f766e' },
        ].map((stat) => (
          <Grid size={3} key={stat.label}>
            {summary.isLoading ? (
              <Skeleton variant="rounded" height={90} />
            ) : (
              <Card sx={{ borderLeft: `4px solid ${stat.color}` }}>
                <CardContent>
                  <Typography variant="h4" sx={{ color: stat.color, fontWeight: 700 }}>{stat.value}</Typography>
                  <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
                </CardContent>
              </Card>
            )}
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {view === 'operator' ? 'What to Fix This Week' : 'Top Risk Drivers'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {view === 'operator'
                  ? 'Prioritized tasks with the highest impact.'
                  : 'Where risk is concentrated across sources.'}
              </Typography>
              {view === 'operator' ? (
                topRisks.isLoading ? (
                  <Skeleton height={180} />
                ) : topRisksData.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                    No open findings. You’re in great shape.
                  </Typography>
                ) : (
                  <Stack spacing={1.5}>
                    {topRisksData.slice(0, 6).map((f: any) => (
                      <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Chip label={f.severity} size="small" sx={{ bgcolor: SEVERITY_COLORS[f.severity] ?? '#64748b', color: '#fff' }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {f.title?.length > 70 ? f.title.slice(0, 67) + '...' : f.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {f.repository?.name ?? f.server?.hostname ?? f.certificate?.subjectCn ?? 'Unknown asset'}
                          </Typography>
                        </Box>
                        <Button size="small" variant="outlined" component={Link} to={`/findings/${f.id}`}>
                          View fix
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )
              ) : (
                <Stack spacing={1.5}>
                  {riskSources.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                      No data yet.
                    </Typography>
                  ) : riskSources.map((s) => (
                    <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Chip label={s.key} size="small" variant="outlined" />
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, (s.value / Math.max(1, topRisksData.length)) * 100)}
                          sx={{
                            height: 8,
                            borderRadius: 4,
                            bgcolor: '#efece6',
                            '& .MuiLinearProgress-bar': { bgcolor: '#0f766e' },
                          }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">{s.value} findings</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={5}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Posture Health</Typography>
              {assets.isLoading ? <Skeleton height={120} /> : assetsData && (
                <Stack spacing={2}>
                  {[
                    { label: 'Repositories', key: 'repositories' },
                    { label: 'Servers', key: 'servers' },
                    { label: 'Certificates', key: 'certificates' },
                  ].map(({ label, key }) => {
                    const d = assetsData[key] ?? { total: 0, affected: 0, health_pct: 100 };
                    return (
                      <Box key={key}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                          <Typography variant="body2">{label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {d.total} total, {d.affected} affected
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={d.health_pct}
                          sx={{
                            height: 8,
                            borderRadius: 4,
                            bgcolor: '#efece6',
                            '& .MuiLinearProgress-bar': { bgcolor: d.health_pct >= 90 ? '#16a34a' : d.health_pct >= 70 ? '#f59e0b' : '#dc2626' },
                          }}
                        />
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Plan Usage</Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1.5}>
                {[
                  { label: 'Servers', used: usage.servers, limit: planLimits.servers },
                  { label: 'Repos', used: usage.repos, limit: planLimits.repos },
                  { label: 'Certs', used: usage.certs, limit: planLimits.certs },
                ].map((item) => {
                  const pct = Math.min(100, (item.used / item.limit) * 100 || 0);
                  return (
                    <Box key={item.label}>
                      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Typography variant="body2">{item.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.used}/{item.limit}</Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{
                          height: 8,
                          borderRadius: 4,
                          bgcolor: '#efece6',
                          '& .MuiLinearProgress-bar': { bgcolor: pct > 85 ? '#dc2626' : pct > 60 ? '#f59e0b' : '#0f766e' },
                        }}
                      />
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {view === 'operator' ? 'Risk Trend (30 days)' : 'Posture Trend (30 days)'}
          </Typography>
          {trends.isLoading ? <Skeleton height={120} /> : trendsData?.new_findings?.length > 0 ? (
            <Box>
              <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
                <Typography variant="caption"><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: 1, bgcolor: '#dc2626', mr: 0.5, verticalAlign: 'middle' }} /> New</Typography>
                <Typography variant="caption"><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: 1, bgcolor: '#16a34a', mr: 0.5, verticalAlign: 'middle' }} /> Resolved</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 100 }}>
                {trendsData.new_findings.map((p: { date: string; count: number }, i: number) => {
                  const max = Math.max(1, ...trendsData.new_findings.map((x: any) => x.count), ...trendsData.resolved_findings.map((x: any) => x.count));
                  const rp = trendsData.resolved_findings[i];
                  return (
                    <Box key={p.date} sx={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: '100%', gap: '1px' }}>
                      <Box sx={{ flex: 1, height: `${(p.count / max) * 100}%`, bgcolor: '#dc2626', borderRadius: '2px 2px 0 0', minHeight: p.count > 0 ? 2 : 0 }} />
                      <Box sx={{ flex: 1, height: `${((rp?.count ?? 0) / max) * 100}%`, bgcolor: '#16a34a', borderRadius: '2px 2px 0 0', minHeight: rp?.count > 0 ? 2 : 0 }} />
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No data yet</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
