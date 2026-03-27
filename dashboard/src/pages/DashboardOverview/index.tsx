import { useEffect } from 'react';
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
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import { Link } from 'react-router-dom';

export function DashboardOverview() {
  const summary = useDashboardSummary();
  const topRisks = useDashboardTopRisks();
  const assets = useDashboardAssets();
  const trends = useFindingsTrends({ interval: 'day', days: 30 });
  const qc = useQueryClient();

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

  const severities = ['critical', 'high', 'medium', 'low'] as const;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Dashboard</Typography>

      {/* Severity Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {severities.map((sev) => (
          <Grid item xs={3} key={sev}>
            {summary.isLoading ? (
              <Skeleton variant="rounded" height={100} />
            ) : (
              <Card sx={{ borderLeft: `4px solid ${SEVERITY_COLORS[sev]}` }}>
                <CardContent sx={{ py: 2 }}>
                  <Typography variant="h4" sx={{ color: SEVERITY_COLORS[sev], fontWeight: 700 }}>
                    {findingsData?.by_severity?.[sev] ?? 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {sev}
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Grid>
        ))}
      </Grid>

      {/* Summary stats row */}
      {findingsData && (
        <Box sx={{ display: 'flex', gap: 3, mb: 3 }}>
          <Typography variant="body2" color="text.secondary">Total: <strong>{findingsData.total ?? 0}</strong></Typography>
          <Typography variant="body2" color="text.secondary">Open: <strong>{findingsData.open ?? 0}</strong></Typography>
          <Typography variant="body2" color="text.secondary">Resolved: <strong>{findingsData.resolved ?? 0}</strong></Typography>
        </Box>
      )}

      {/* Assets Overview + Trends */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {/* Assets */}
        <Grid item xs={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Assets Overview</Typography>
              {assets.isLoading ? <Skeleton height={120} /> : assetsData && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[
                    { label: 'Repositories', key: 'repositories', icon: '📦' },
                    { label: 'Servers', key: 'servers', icon: '🖥️' },
                    { label: 'Certificates', key: 'certificates', icon: '🔒' },
                  ].map(({ label, key, icon }) => {
                    const d = assetsData[key] ?? { total: 0, affected: 0, health_pct: 100 };
                    return (
                      <Box key={key}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="body2">{icon} {label}</Typography>
                          <Typography variant="caption" color="text.secondary">{d.total} total, {d.affected} affected</Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={d.health_pct}
                          sx={{
                            height: 8, borderRadius: 4,
                            bgcolor: '#e2e8f0',
                            '& .MuiLinearProgress-bar': { bgcolor: d.health_pct >= 90 ? '#16a34a' : d.health_pct >= 70 ? '#f59e0b' : '#dc2626' },
                          }}
                        />
                        <Typography variant="caption" sx={{ color: d.health_pct >= 90 ? '#16a34a' : d.health_pct >= 70 ? '#f59e0b' : '#dc2626', fontWeight: 600 }}>
                          {d.health_pct}% healthy
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Trends */}
        <Grid item xs={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Findings Trend (30d)</Typography>
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
        </Grid>
      </Grid>

      {/* Top Risks Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Top Risks</Typography>
          {topRisks.isLoading ? <Skeleton height={200} /> : topRisksData.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No open findings</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Severity</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Asset</TableCell>
                    <TableCell>CVE</TableCell>
                    <TableCell align="right">CVSS</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {topRisksData.map((f: any) => (
                    <TableRow key={f.id} hover>
                      <TableCell>
                        <Chip label={f.severity} size="small" sx={{ bgcolor: SEVERITY_COLORS[f.severity] ?? '#64748b', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }} />
                      </TableCell>
                      <TableCell>
                        <Link to={`/findings/${f.id}`} style={{ color: '#0f172a', textDecoration: 'none' }}>
                          {f.title?.length > 55 ? f.title.slice(0, 52) + '...' : f.title}
                        </Link>
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{f.repository?.name ?? f.server?.hostname ?? f.certificate?.subjectCn ?? '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{f.cveId ?? '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{f.cvssScore ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
