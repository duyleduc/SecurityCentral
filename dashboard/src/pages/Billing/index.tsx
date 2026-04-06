import { Box, Card, CardContent, Typography, LinearProgress, Stack, Button } from '@mui/material';
import { useDashboardSummary } from '../../api/hooks.js';

const PLAN_LIMITS = {
  starter: { servers: 25, repos: 20, certs: 50 },
};

export function BillingPage() {
  const summary = useDashboardSummary();
  const assets = (summary.data?.data as any)?.assets ?? { repositories: 0, servers: 0, certificates: 0 };

  const limits = PLAN_LIMITS.starter;

  const usageItems = [
    { label: 'Servers', used: assets.servers ?? 0, limit: limits.servers },
    { label: 'Repositories', used: assets.repositories ?? 0, limit: limits.repos },
    { label: 'Certificates', used: assets.certificates ?? 0, limit: limits.certs },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Billing</Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Box>
              <Typography variant="subtitle2">Current Plan</Typography>
              <Typography variant="h4" sx={{ mt: 0.5 }}>Starter</Typography>
              <Typography variant="body2" color="text.secondary">Next billing date: 30 days</Typography>
            </Box>
            <Button variant="contained" color="secondary">Upgrade to Growth</Button>
          </Stack>

          <Stack spacing={2}>
            {usageItems.map((item) => {
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

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>Usage Forecast</Typography>
          <Typography variant="body2" color="text.secondary">
            At the current pace, you will hit a plan limit in about 12 days. Upgrade early to avoid scan pauses.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
