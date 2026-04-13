import { useState } from 'react';
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
  Stack,
  TextField,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import CodeIcon from '@mui/icons-material/Code';
import GitHubIcon from '@mui/icons-material/GitHub';
import EditIcon from '@mui/icons-material/Edit';
import CampaignIcon from '@mui/icons-material/Campaign';
import CloseIcon from '@mui/icons-material/Close';
import { useProject, useUpdateProject } from '../../api/hooks';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id ?? '');
  const updateMutation = useUpdateProject();

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [bannerOpen, setBannerOpen] = useState(false);
  const [bannerDraft, setBannerDraft] = useState('');

  if (isLoading) return <Typography>Loading...</Typography>;
  if (!project) return <Typography>Project not found</Typography>;

  const detail = project as unknown as {
    id: string;
    name: string;
    description: string;
    notes: string;
    banner: string | null;
    servers: Array<{ id: string; hostname: string; status: string }>;
    monitoredEndpoints: Array<{ id: string; host: string; status: string }>;
    repositories: Array<{ id: string; owner: string; name: string; provider: string; language: string | null; lastScanAt: string | null }>;
    _count: { servers: number; monitoredEndpoints: number; repositories: number };
  };

  const handleNotesOpen = () => {
    setNotesDraft(detail.notes);
    setNotesOpen(true);
  };

  const handleNotesSave = () => {
    updateMutation.mutate({ id: detail.id, notes: notesDraft }, {
      onSuccess: () => setNotesOpen(false),
    });
  };

  const handleBannerOpen = () => {
    setBannerDraft(detail.banner ?? '');
    setBannerOpen(true);
  };

  const handleBannerSave = () => {
    updateMutation.mutate({ id: detail.id, banner: bannerDraft || null }, {
      onSuccess: () => setBannerOpen(false),
    });
  };

  const handleBannerRemove = () => {
    updateMutation.mutate({ id: detail.id, banner: null });
  };

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/projects')} sx={{ mb: 2 }}>
        Back to Projects
      </Button>

      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
        <Box>
          <Typography variant="h4">{detail.name}</Typography>
          {detail.description && (
            <Typography variant="body1" color="text.secondary" mt={0.5}>
              {detail.description}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<CampaignIcon />} onClick={handleBannerOpen}>
            {detail.banner ? 'Edit Banner' : 'Set Banner'}
          </Button>
        </Stack>
      </Stack>

      {/* Banner */}
      {detail.banner && (
        <Alert
          severity="info"
          icon={<CampaignIcon />}
          sx={{ mb: 2 }}
          action={
            <IconButton size="small" color="inherit" onClick={handleBannerRemove} title="Remove banner">
              <CloseIcon fontSize="small" />
            </IconButton>
          }
        >
          {detail.banner}
        </Alert>
      )}

      {/* Notes */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="h6">Notes</Typography>
            <IconButton size="small" onClick={handleNotesOpen} title="Edit notes">
              <EditIcon fontSize="small" />
            </IconButton>
          </Stack>
          {detail.notes ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
              {detail.notes}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.disabled">
              No notes yet. Click edit to add project information like client, project manager, etc.
            </Typography>
          )}
        </CardContent>
      </Card>

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

      {/* Notes Edit Dialog */}
      <Dialog open={notesOpen} onClose={() => setNotesOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Notes</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            minRows={6}
            maxRows={20}
            fullWidth
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Client: Acme Corp&#10;Project Manager: Jane Doe&#10;Environment: Production&#10;&#10;Any freeform notes about this project..."
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: 10000 } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            {notesDraft.length} / 10,000
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNotesOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleNotesSave} disabled={updateMutation.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Banner Edit Dialog */}
      <Dialog open={bannerOpen} onClose={() => setBannerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Set Project Banner</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            The banner is displayed at the top of the project page for all team members.
          </Typography>
          <TextField
            fullWidth
            value={bannerDraft}
            onChange={(e) => setBannerDraft(e.target.value)}
            placeholder="e.g. Maintenance window scheduled for April 15, 10pm-2am UTC"
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
            {bannerDraft.length} / 500
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBannerOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleBannerSave} disabled={updateMutation.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
