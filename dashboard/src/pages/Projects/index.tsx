import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, CardActionArea, Grid, Button, Chip, Stack, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Skeleton, IconButton, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import BugReportIcon from '@mui/icons-material/BugReport';
import DnsIcon from '@mui/icons-material/Dns';
import CodeIcon from '@mui/icons-material/Code';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useProjects, useCreateProject, useDeleteProject, useUpdateProject, type Project } from '../../api/hooks.js';
import { SEVERITY_COLORS } from '../../theme/theme.js';
import { ProjectDetail } from './ProjectDetail.js';
import { ServersList } from '../Assets/ServersList.js';
import { RepositoriesList } from '../Assets/RepositoriesList.js';
import { CertificatesList } from '../Assets/CertificatesList.js';
import { DomainMonitoringPage } from '../Monitoring/DomainMonitoring.js';

export function ProjectsPage() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'projects';

  if (id) return <ProjectDetail projectId={id} />;

  const handleTabChange = (_: React.SyntheticEvent, value: string) => {
    if (value === 'projects') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: value });
    }
  };

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={handleTabChange}
        sx={{ mb: 2 }}
        textColor="primary"
        indicatorColor="primary"
      >
        <Tab value="projects" label="Projects" />
        <Tab value="servers" label="Servers" />
        <Tab value="repositories" label="Repositories" />
        <Tab value="certificates" label="Certificates" />
        <Tab value="domains" label="Domains" />
      </Tabs>

      {tab === 'projects' && <ProjectList />}
      {tab === 'servers' && <ServersList />}
      {tab === 'repositories' && <RepositoriesList />}
      {tab === 'certificates' && <CertificatesList />}
      {tab === 'domains' && <DomainMonitoringPage embedded />}
    </Box>
  );
}

function ProjectList() {
  const projects = useProjects();
  const data = (projects.data?.data ?? []) as Project[];
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const navigate = useNavigate();

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h4">Projects</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          New Project
        </Button>
      </Stack>

      {projects.isLoading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
              <Skeleton variant="rounded" height={180} />
            </Grid>
          ))}
        </Grid>
      ) : data.length === 0 ? (
        <Card sx={{ py: 8, textAlign: 'center' }}>
          <CardContent>
            <FolderIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>No projects yet</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Create a project to organize your repositories, servers, and domains
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              Create First Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {data.map((project) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={project.id}>
              <ProjectCard project={project} onClick={() => navigate(`/projects/${project.id}`)} onEdit={() => setEditTarget(project)} />
            </Grid>
          ))}
        </Grid>
      )}

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditProjectDialog project={editTarget} onClose={() => setEditTarget(null)} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Project Card
// ---------------------------------------------------------------------------

function ProjectCard({ project, onClick, onEdit }: { project: Project; onClick: () => void; onEdit: () => void }) {
  const deleteMutation = useDeleteProject();

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardActionArea onClick={onClick} sx={{ flex: 1, p: 0 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6" sx={{ mb: 0.5 }}>{project.name}</Typography>
              {project.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {project.description.length > 80 ? project.description.slice(0, 77) + '...' : project.description}
                </Typography>
              )}
            </Box>
            {project.openFindings > 0 && (
              <Chip
                icon={<BugReportIcon />}
                label={project.openFindings}
                size="small"
                color="error"
              />
            )}
          </Stack>

          {/* Asset counts */}
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <CodeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">{project.repoCount} repos</Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <DnsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">{project.serverCount} servers</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>

      <Box sx={{ px: 2, pb: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
        <Tooltip title="Edit project">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete project">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${project.name}"? Assets won't be deleted.`)) deleteMutation.mutate(project.id); }}
            sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create Project Dialog
// ---------------------------------------------------------------------------

function EditProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const updateMutation = useUpdateProject();

  const handleOpen = () => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? '');
    }
  };

  const handleSave = async () => {
    if (!project || !name.trim()) return;
    await updateMutation.mutateAsync({ id: project.id, name: name.trim(), description: description || undefined });
    onClose();
  };

  return (
    <Dialog open={project !== null} onClose={onClose} maxWidth="sm" fullWidth TransitionProps={{ onEnter: handleOpen }}>
      <DialogTitle>Edit Project</DialogTitle>
      <DialogContent>
        <TextField
          label="Project Name" fullWidth required autoFocus
          value={name} onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }} size="small"
        />
        <TextField
          label="Description (optional)" fullWidth multiline rows={2}
          value={description} onChange={(e) => setDescription(e.target.value)}
          size="small"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!name.trim() || updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMutation = useCreateProject();
  const navigate = useNavigate();

  const handleCreate = async () => {
    const result = await createMutation.mutateAsync({ name, description: description || undefined });
    setName('');
    setDescription('');
    onClose();
    const created = result.data as Project | undefined;
    if (created?.id) navigate(`/projects/${created.id}`);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Project</DialogTitle>
      <DialogContent>
        <TextField
          label="Project Name" fullWidth required autoFocus
          value={name} onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }} size="small"
        />
        <TextField
          label="Description (optional)" fullWidth multiline rows={2}
          value={description} onChange={(e) => setDescription(e.target.value)}
          size="small"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate} disabled={!name.trim() || createMutation.isPending}>
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
