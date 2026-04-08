import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import { useProjects, useCreateProject } from '../../api/hooks';

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
    setName('');
    setDescription('');
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Projects</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New Project
        </Button>
      </Box>

      {isLoading && <Typography>Loading...</Typography>}

      <Grid container spacing={3}>
        {projects?.map((p) => (
          <Grid key={p.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardActionArea onClick={() => navigate(`/projects/${p.id}`)}>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <FolderIcon color="primary" />
                    <Typography variant="h6">{p.name}</Typography>
                  </Box>
                  {p.description && (
                    <Typography variant="body2" color="text.secondary" mb={2} noWrap>
                      {p.description}
                    </Typography>
                  )}
                  <Box display="flex" gap={1}>
                    <Chip label={`${p._count?.servers ?? 0} servers`} size="small" />
                    <Chip label={`${p._count?.monitoredEndpoints ?? 0} domains`} size="small" />
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Project</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            margin="normal"
            autoFocus
          />
          <TextField
            fullWidth
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            margin="normal"
            multiline
            rows={3}
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
