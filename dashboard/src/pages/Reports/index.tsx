import { useFindingsTrends, useDashboardSummary } from '../../api/hooks.js';
import { Box, Card, CardContent, Typography, Grid, Skeleton, Divider } from '@mui/material';

export function ReportsPage() {
  const summary = useDashboardSummary();
  const trends = useFindingsTrends({ interval: 'day', days: 30 });

  const findings = (summary.data?.data as any)?.findings;
  const trend = trends.data?.data as any;

  const max = Math.max(
    1,
    ...(trend?.new_findings ?? []).map((p: any) => p.count),
    ...(trend?.resolved_findings ?? []).map((p: any) => p.count),
  );

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Weekly Summary</Typography>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2">Total Findings</Typography>
              {summary.isLoading ? <Skeleton height={30} /> : (
                <Typography variant="h4" sx={{ mt: 1 }}>{findings?.total ?? 0}</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2">Open</Typography>
              {summary.isLoading ? <Skeleton height={30} /> : (
                <Typography variant="h4" sx={{ mt: 1 }}>{findings?.open ?? 0}</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2">Resolved</Typography>
              {summary.isLoading ? <Skeleton height={30} /> : (
                <Typography variant="h4" sx={{ mt: 1 }}>{findings?.resolved ?? 0}</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>30-Day Risk Trend</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            New vs resolved findings over the last month.
          </Typography>
          {trends.isLoading ? (
            <Skeleton height={120} />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 120 }}>
              {(trend?.new_findings ?? []).map((p: any, i: number) => {
                const rp = trend?.resolved_findings?.[i];
                return (
                  <Box key={p.date} sx={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '1px', height: '100%' }}>
                    <Box sx={{ flex: 1, height: `${(p.count / max) * 100}%`, bgcolor: '#dc2626', borderRadius: '3px 3px 0 0' }} />
                    <Box sx={{ flex: 1, height: `${((rp?.count ?? 0) / max) * 100}%`, bgcolor: '#16a34a', borderRadius: '3px 3px 0 0' }} />
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6">Executive Notes</Typography>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="body2" color="text.secondary">
            Export-ready weekly summary is coming next. For now, this view highlights risk trends and totals
            to share with leadership.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
