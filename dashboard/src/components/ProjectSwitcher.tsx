import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Menu,
  MenuItem,
  Divider,
  Typography,
  Box,
  ListItemIcon,
  ListItemText,
  CircularProgress,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CheckIcon from '@mui/icons-material/Check';
import FolderIcon from '@mui/icons-material/Folder';
import AddIcon from '@mui/icons-material/Add';
import PublicIcon from '@mui/icons-material/Public';
import { useProjects } from '../api/hooks';
import { useProjectScope } from '../lib/useProjectScope';

export function ProjectSwitcher() {
  const navigate = useNavigate();
  const { projectId, setProject } = useProjectScope();
  const { data: projects, isLoading } = useProjects();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const selectedProject = projects?.find((p) => p.id === projectId) ?? null;
  const label = selectedProject ? selectedProject.name : 'All projects';

  const handlePick = (id: string | null) => {
    setProject(id);
    handleClose();
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        variant="outlined"
        size="small"
        endIcon={<KeyboardArrowDownIcon />}
        sx={{
          textTransform: 'none',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 16,
          pl: 1.5,
          pr: 1,
          py: 0.25,
          borderColor: selectedProject ? 'primary.dark' : 'divider',
          color: selectedProject ? 'primary.light' : 'text.secondary',
          bgcolor: selectedProject ? 'action.selected' : 'transparent',
          '&:hover': {
            borderColor: 'primary.main',
            bgcolor: 'action.hover',
          },
        }}
        startIcon={
          selectedProject ? (
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: 'success.main',
              }}
            />
          ) : (
            <PublicIcon sx={{ fontSize: 16 }} />
          )
        }
      >
        {label}
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          paper: {
            sx: { minWidth: 240, mt: 0.5 },
          },
        }}
      >
        <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}>
          Scope the app to a project
        </Typography>
        <Divider />

        <MenuItem selected={projectId === null} onClick={() => handlePick(null)}>
          <ListItemIcon>
            <PublicIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="All projects" />
          {projectId === null && <CheckIcon fontSize="small" sx={{ ml: 'auto' }} />}
        </MenuItem>

        <Divider />

        {isLoading && (
          <MenuItem disabled>
            <CircularProgress size={14} sx={{ mr: 1 }} />
            Loading…
          </MenuItem>
        )}

        {!isLoading && projects && projects.length === 0 && (
          <MenuItem disabled>
            <ListItemText primary="No projects yet" secondary="Create one to scope your assets" />
          </MenuItem>
        )}

        {projects?.map((p) => {
          const isActive = p.id === projectId;
          return (
            <MenuItem key={p.id} selected={isActive} onClick={() => handlePick(p.id)}>
              <ListItemIcon>
                <FolderIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={p.name} />
              {isActive && <CheckIcon fontSize="small" sx={{ ml: 'auto' }} />}
            </MenuItem>
          );
        })}

        <Divider />
        <MenuItem
          onClick={() => {
            handleClose();
            navigate('/projects');
          }}
        >
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="New project…" />
        </MenuItem>
      </Menu>
    </>
  );
}
