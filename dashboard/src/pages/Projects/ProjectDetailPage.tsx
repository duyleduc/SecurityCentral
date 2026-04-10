import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import CodeIcon from '@mui/icons-material/Code';
import GitHubIcon from '@mui/icons-material/GitHub';
import { useProject } from '../../api/hooks';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id ?? '');

  if (isLoading) return <Typography>Loading...</Typography>;
  if (!project) return <Typography>Project not found</Typography>;

  const detail = project as unknown as {
    id: string;
    name: string;
    description: string;
    servers: Array<{ id: string; hostname: string; status: string }>;
    monitoredEndpoints: Array<{ id: string; host: string; status: string }>;
    repositories: Array<{ id: string; owner: string; name: string; provider: string; language: string | null; lastScanAt: string | null }>;
    _count: { servers: number; monitoredEndpoints: number; repositories: number };
  };

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/projects')} sx={{ mb: 2 }}>
        Back to Projects
      </Button>

      <Typography variant="h4" mb={1}>
        {detail.name}
      </Typography>
      {detail.description && (
        <Typography variant="body1" color="text.secondary" mb={3}>
          {detail.description}
        </Typography>
      )}

      <Grid container spacing={3} mb={3}>
        {/* Repositories */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={1}>
                Repositories ({detail._count.repositories})
              </Typography>
              {detail.repositories.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No repositories linked yet
                </Typography>
              ) : (
                <List dense>
                  {detail.repositories.map((r) => (
                    <ListItem
                      key={r.id}
                      onClick={() => navigate(`/repositories/${r.id}`)}
                      sx={{ cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <ListItemIcon>
                        {r.provider === 'github' ? <GitHubIcon /> : <CodeIcon />}
                      </ListItemIcon>
                      <ListItemText
                        primary={`${r.owner}/${r.name}`}
                        secondary={[r.language, r.lastScanAt ? `Scanned ${new Date(r.lastScanAt).toLocaleDateString()}` : 'Never scanned'].filter(Boolean).join(' · ')}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Servers */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={1}>
                Servers ({detail._count.servers})
              </Typography>
              {detail.servers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No servers linked yet
                </Typography>
              ) : (
                <List dense>
                  {detail.servers.map((s) => (
                    <ListItem
                      key={s.id}
                      onClick={() => navigate(`/servers/${s.id}`)}
                      sx={{ cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <ListItemIcon>
                        <StorageIcon />
                      </ListItemIcon>
                      <ListItemText primary={s.hostname} />
                      <Chip label={s.status} size="small" color={s.status === 'online' ? 'success' : 'default'} />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Domains */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={1}>
                Domains ({detail._count.monitoredEndpoints})
              </Typography>
              {detail.monitoredEndpoints.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No domains linked yet
                </Typography>
              ) : (
                <List dense>
                  {detail.monitoredEndpoints.map((e) => (
                    <ListItem
                      key={e.id}
                      onClick={() => navigate(`/domains/${e.id}`)}
                      sx={{ cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <ListItemIcon>
                        <DnsIcon />
                      </ListItemIcon>
                      <ListItemText primary={e.host} />
                      <Chip
                        label={e.status}
                        size="small"
                        color={e.status === 'healthy' ? 'success' : e.status === 'degraded' ? 'warning' : 'error'}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
