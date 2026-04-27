import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import { useProjects, useCreateProject } from '../../api/hooks';

const PROJECT_COLOURS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7'];

function colourFor(id: string): string {
  // Stable hash → colour palette index.
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_COLOURS[hash % PROJECT_COLOURS.length];
}

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = async () => {
    await createProject.mutateAsync({ name, description });
    setOpen(false);
    setName(''); setDescription('');
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Box>
          <Typography variant="h4">Projects</Typography>
          <Typography variant="body2" color="text.secondary">
            Group servers, domains, and repositories under a project to apply shared policies and notifications.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New Project
        </Button>
      </Stack>

      {isLoading && <Typography>Loading…</Typography>}

      {/* List-card grid (mockup .list-card) */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        gap: 2,
      }}>
        {projects?.map((p) => {
          const counts = p._count as { servers?: number; monitoredEndpoints?: number; repositories?: number };
          const colour = (p as { banner?: string | null }).banner || colourFor(p.id);
          const meta = [
            `${counts?.servers ?? 0} servers`,
            `${counts?.monitoredEndpoints ?? 0} domains`,
            `${counts?.repositories ?? 0} repos`,
          ].join(' · ');
          return (
            <Card
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              sx={{
                p: 2.25, cursor: 'pointer', transition: 'border-color 0.15s',
                '&:hover': { borderColor: 'rgba(99, 102, 241, 0.4)' },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
                <Box sx={{
                  width: 32, height: 32, borderRadius: 1, flexShrink: 0,
                  background: `linear-gradient(135deg, ${colour}, ${colour}cc)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <FolderIcon sx={{ fontSize: 18, color: '#fff' }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 600 }} noWrap>{p.name}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.25 }} noWrap>
                    {meta}
                  </Typography>
                </Box>
              </Stack>
              {p.description && (
                <Typography variant="body2" color="text.secondary" sx={{
                  fontSize: 13, lineHeight: 1.55,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {p.description}
                </Typography>
              )}
            </Card>
          );
        })}

        {!isLoading && projects?.length === 0 && (
          <Card sx={{ p: 3, gridColumn: '1 / -1', textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No projects yet. Click <strong>New Project</strong> to create one.
            </Typography>
          </Card>
        )}
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Project</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth label="Project name" value={name}
            onChange={(e) => setName(e.target.value)} margin="normal" autoFocus
          />
          <TextField
            fullWidth label="Description" value={description}
            onChange={(e) => setDescription(e.target.value)} margin="normal"
            multiline rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!name || createProject.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
