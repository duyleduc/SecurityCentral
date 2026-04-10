import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, TextField, Stack, Alert,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Checkbox, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, Select, MenuItem,
  FormControl, InputLabel,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SyncIcon from '@mui/icons-material/Sync';
import FolderIcon from '@mui/icons-material/Folder';
import AddIcon from '@mui/icons-material/Add';
import {
  useGitHubRepos,
  useGitLabRepos,
  useSyncRepos,
  useProjects,
  useCreateProject,
  type ProviderRepo,
} from '../../api/hooks';

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', Go: '#00add8', Python: '#3776ab',
  Java: '#b07219', Rust: '#dea584', Ruby: '#701516', PHP: '#4f5d95', Kotlin: '#A97BFF',
  'C#': '#178600', C: '#555555', 'C++': '#f34b7d', Swift: '#F05138', Dart: '#00B4AB',
};

export function RepoSelectionPage() {
  const { provider } = useParams<{ provider: string }>();
  const providerName = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : provider ?? '';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [syncResult, setSyncResult] = useState<{ count: number; error?: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const perPage = 50;

  // Use the right hook based on provider
  const ghRepos = useGitHubRepos(page, perPage);
  const glRepos = useGitLabRepos(page, perPage, search || undefined);

  const isGitHub = provider === 'github';
  const reposData = isGitHub ? ghRepos : glRepos;
  const repos: ProviderRepo[] = (reposData.data as any)?.repos ?? reposData.data ?? [];
  const totalCount: number = (reposData.data as any)?.totalCount ?? repos.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  const syncMutation = useSyncRepos();

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => setSelected(new Set(repos.map((r) => r.id)));
  const selectNone = () => setSelected(new Set());

  const handleSync = () => {
    if (selected.size === 0) return;
    setAssignOpen(true);
  };

  const handleSyncConfirm = async (projectId: string | null) => {
    setAssignOpen(false);
    setSyncResult(null);
    try {
      const selectedRepos = repos.filter((r) => selected.has(r.id));
      await syncMutation.mutateAsync({
        provider: provider!,
        repos: selectedRepos,
        projectId: projectId ?? undefined,
      });
      setSyncResult({ count: selectedRepos.length });
      setSelected(new Set());
    } catch (err) {
      setSyncResult({ count: 0, error: (err as Error).message });
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 2.5 }}>
        <Button component={Link} to="/settings" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
          Back to Settings
        </Button>
        <Typography variant="h5">Select {providerName} Repositories</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Choose which repositories to scan for vulnerabilities
        </Typography>
      </Box>

      {/* Result banners */}
      {syncResult && (
        <Alert
          severity={syncResult.error ? 'error' : 'success'}
          sx={{ mb: 2 }}
          onClose={() => setSyncResult(null)}
        >
          {syncResult.error
            ? `Sync failed: ${syncResult.error}`
            : `${syncResult.count} repository${syncResult.count > 1 ? 'ies' : ''} synced successfully.`}
        </Alert>
      )}

      {/* Search + bulk actions */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }}
          sx={{ flex: 1, maxWidth: 320 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
        />
        <Button size="small" onClick={selectAll}>Select All</Button>
        <Button size="small" onClick={selectNone}>None</Button>
        <Typography variant="caption" color="text.secondary">
          {selected.size > 0 ? `${selected.size} selected` : `${totalCount} repos found`}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<SyncIcon />}
          onClick={handleSync}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          {syncMutation.isPending ? 'Syncing...' : `Sync ${selected.size} Selected`}
        </Button>
      </Stack>

      {/* Repo table */}
      <TableContainer component={Paper}>
        {reposData.isLoading ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Skeleton variant="text" width="60%" sx={{ mx: 'auto', mb: 1 }} />
            <Skeleton variant="text" width="40%" sx={{ mx: 'auto' }} />
          </Box>
        ) : repos.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {search ? 'No repositories match your search' : 'No repositories found'}
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 40 }} />
                <TableCell>Repository</TableCell>
                <TableCell>Language</TableCell>
                <TableCell>Visibility</TableCell>
                <TableCell>Default Branch</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {repos.map((repo) => {
                const isSelected = selected.has(repo.id);
                const langColor = repo.language ? LANG_COLOR[repo.language] ?? '#6b7280' : undefined;

                return (
                  <TableRow key={repo.id} hover sx={{ bgcolor: isSelected ? 'action.selected' : undefined }}>
                    <TableCell>
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={() => toggleSelect(repo.id)}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>{repo.fullName}</TableCell>
                    <TableCell>
                      {repo.language ? (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: langColor }} />
                          <Typography variant="body2">{repo.language}</Typography>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">--</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={repo.private ? 'Private' : 'Public'}
                        size="small"
                        color={repo.private ? 'default' : 'success'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                      {repo.defaultBranch}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Pagination */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
        <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => { setPage(page - 1); setSelected(new Set()); }}>
          Previous
        </Button>
        <Typography variant="body2" color="text.secondary">
          Page {page} of {totalPages}
        </Typography>
        <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => { setPage(page + 1); setSelected(new Set()); }}>
          Next
        </Button>
      </Stack>

      {/* Project assignment dialog */}
      <AssignProjectDialog
        open={assignOpen}
        repoCount={selected.size}
        onConfirm={handleSyncConfirm}
        onClose={() => setAssignOpen(false)}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Dialog: Assign repos to a project during sync
// ---------------------------------------------------------------------------

function AssignProjectDialog({ open, repoCount, onConfirm, onClose }: {
  open: boolean;
  repoCount: number;
  onConfirm: (projectId: string | null) => void;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const createProject = useCreateProject();
  const [mode, setMode] = useState<'existing' | 'new' | 'skip'>('new');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');

  const handleConfirm = async () => {
    if (mode === 'skip') {
      onConfirm(null);
      return;
    }
    if (mode === 'new' && newProjectName.trim()) {
      try {
        const result = await createProject.mutateAsync({ name: newProjectName.trim() });
        onConfirm((result as any)?.id ?? null);
      } catch {
        onConfirm(null);
      }
      return;
    }
    if (mode === 'existing' && selectedProjectId) {
      onConfirm(selectedProjectId);
      return;
    }
    onConfirm(null);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <FolderIcon color="primary" />
          <Typography variant="h6">Assign to Project</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Syncing {repoCount} repositor{repoCount > 1 ? 'ies' : 'y'}. Assign them to a project for better organization.
        </Typography>

        <Stack spacing={1.5}>
          {/* Create new project */}
          <Paper
            variant="outlined" onClick={() => setMode('new')}
            sx={{
              p: 2, cursor: 'pointer',
              borderColor: mode === 'new' ? 'primary.main' : 'divider',
              bgcolor: mode === 'new' ? 'action.hover' : 'transparent',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: mode === 'new' ? 1 : 0 }}>
              <AddIcon color={mode === 'new' ? 'primary' : 'disabled'} fontSize="small" />
              <Typography variant="subtitle2">Create new project</Typography>
            </Stack>
            {mode === 'new' && (
              <TextField
                size="small" fullWidth autoFocus label="Project name"
                value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                sx={{ mt: 1 }}
              />
            )}
          </Paper>

          {/* Select existing project */}
          {(projects?.length ?? 0) > 0 && (
            <Paper
              variant="outlined" onClick={() => setMode('existing')}
              sx={{
                p: 2, cursor: 'pointer',
                borderColor: mode === 'existing' ? 'primary.main' : 'divider',
                bgcolor: mode === 'existing' ? 'action.hover' : 'transparent',
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: mode === 'existing' ? 1 : 0 }}>
                <FolderIcon color={mode === 'existing' ? 'primary' : 'disabled'} fontSize="small" />
                <Typography variant="subtitle2">Add to existing project</Typography>
              </Stack>
              {mode === 'existing' && (
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>Select project</InputLabel>
                  <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} label="Select project">
                    {projects?.map((p) => (
                      <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Paper>
          )}

          {/* Skip */}
          <Paper
            variant="outlined" onClick={() => setMode('skip')}
            sx={{
              p: 2, cursor: 'pointer',
              borderColor: mode === 'skip' ? 'primary.main' : 'divider',
              bgcolor: mode === 'skip' ? 'action.hover' : 'transparent',
            }}
          >
            <Typography variant="subtitle2" color={mode === 'skip' ? 'primary' : 'text.secondary'}>
              Skip — sync without assigning to a project
            </Typography>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained" onClick={handleConfirm}
          disabled={
            (mode === 'new' && !newProjectName.trim()) ||
            (mode === 'existing' && !selectedProjectId) ||
            createProject.isPending
          }
        >
          {createProject.isPending ? 'Creating...' : `Sync ${repoCount} Repos`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
