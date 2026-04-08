import { Box, Typography, Card, CardContent, Grid } from '@mui/material';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import { useProjects, useEndpoints } from '../../api/hooks';

export function DashboardOverviewPage() {
  const { data: projects } = useProjects();
  const { data: endpoints } = useEndpoints();

  const stats = [
    { label: 'Projects', value: projects?.length ?? 0, icon: <FolderIcon sx={{ fontSize: 40 }} /> },
    { label: 'Domains', value: endpoints?.length ?? 0, icon: <DnsIcon sx={{ fontSize: 40 }} /> },
    { label: 'Servers', value: 0, icon: <StorageIcon sx={{ fontSize: 40 }} /> },
  ];

  const healthyEndpoints = endpoints?.filter((e) => e.status === 'healthy').length ?? 0;
  const degradedEndpoints = endpoints?.filter((e) => e.status === 'degraded').length ?? 0;
  const downEndpoints = endpoints?.filter((e) => e.status === 'down').length ?? 0;

  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Dashboard
      </Typography>

      <Grid container spacing={3} mb={4}>
        {stats.map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ color: 'primary.main' }}>{s.icon}</Box>
                <Box>
                  <Typography variant="h4">{s.value}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {s.label}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h5" mb={2}>
        Domain Health
      </Typography>
      <Grid container spacing={3}>
        {[
          { label: 'Healthy', value: healthyEndpoints, color: 'success.main' },
          { label: 'Degraded', value: degradedEndpoints, color: 'warning.main' },
          { label: 'Down', value: downEndpoints, color: 'error.main' },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent>
                <Typography variant="h3" color={s.color}>
                  {s.value}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {s.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
