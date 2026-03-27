import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, TextField, Stack, Alert,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Checkbox, InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SyncIcon from '@mui/icons-material/Sync';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { useProviderRepos, useSyncRepos, useUnsyncRepo, type DiscoveredRepo } from '../../api/hooks.js';

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', Go: '#00add8', Python: '#3776ab',
  Java: '#b07219', Rust: '#dea584', Ruby: '#701516', PHP: '#4f5d95', Kotlin: '#A97BFF',
};

export function RepoSelectionPage() {
  const { provider } = useParams<{ provider: string }>();
  const providerName = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : provider ?? '';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncResult, setSyncResult] = useState<{ synced: number; errors: string[] } | null>(null);

  const perPage = 50;
  const repos = useProviderRepos(provider ?? '', { search: search || undefined, page, per_page: perPage });
  const syncMutation = useSyncRepos(provider ?? '');
  const unsyncMutation = useUnsyncRepo(provider ?? '');

  const data = (repos.data?.data ?? []) as DiscoveredRepo[];
  const total = repos.data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / perPage);

  const unsyncedOnPage = useMemo(() => data.filter((r) => !r.synced), [data]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelected(new Set(unsyncedOnPage.map((r) => r.provider_id)));
  };

  const selectNone = () => setSelected(new Set());

  const handleSync = async () => {
    if (selected.size === 0) return;
    setSyncResult(null);
    try {
      const result = await syncMutation.mutateAsync([...selected]);
      setSyncResult(result.data as { synced: number; errors: string[] });
      setSelected(new Set());
    } catch (err) {
      setSyncResult({ synced: 0, errors: [(err as Error).message] });
    }
  };

  const handleUnsync = (providerId: string) => {
    if (confirm('Unsync this repository? Historical data will be preserved.')) {
      unsyncMutation.mutate(providerId);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 2.5 }}>
        <Button component={Link} to="/integrations" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1 }}>
          Back to Integrations
        </Button>
        <Typography variant="h5">Select {providerName} Repositories</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Choose which repositories to scan for vulnerabilities
        </Typography>
      </Box>

      {/* Sync result banner */}
      {syncResult && (
        <Alert severity={syncResult.errors.length > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
          {syncResult.synced > 0 && <span>{syncResult.synced} repo(s) synced successfully. </span>}
          {syncResult.errors.map((e, i) => <Box key={i}>{e}</Box>)}
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
          {selected.size > 0 ? `${selected.size} selected` : `${total} repos found`}
        </Typography>
      </Stack>

      {/* Repo list */}
      <TableContainer component={Paper}>
        {repos.isLoading ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Skeleton variant="text" width="60%" sx={{ mx: 'auto', mb: 1 }} />
            <Skeleton variant="text" width="40%" sx={{ mx: 'auto' }} />
          </Box>
        ) : data.length === 0 ? (
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
                <TableCell>Last Updated</TableCell>
                <TableCell>Status</TableCell>
                <TableCell sx={{ width: 80 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((repo) => {
                const isSelected = selected.has(repo.provider_id);
                const langColor = repo.language ? LANG_COLOR[repo.language] ?? '#6b7280' : undefined;

                return (
                  <TableRow key={repo.provider_id} hover sx={{ bgcolor: isSelected ? 'action.selected' : undefined }}>
                    <TableCell>
                      {repo.synced ? (
                        <Chip label="&#10003;" size="small" color="success" sx={{ minWidth: 28 }} />
                      ) : (
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => toggleSelect(repo.provider_id)}
                        />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>{repo.full_name}</TableCell>
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
                        label={repo.visibility || 'private'}
                        size="small"
                        color={repo.visibility === 'public' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                      {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '--'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={repo.synced ? 'Synced' : 'Not synced'}
                        size="small"
                        color={repo.synced ? 'success' : 'default'}
                        variant={repo.synced ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {repo.synced && (
                        <Button
                          size="small"
                          color="error"
                          startIcon={<LinkOffIcon />}
                          onClick={() => handleUnsync(repo.provider_id)}
                          disabled={unsyncMutation.isPending}
                        >
                          Unsync
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Footer: pagination + sync button */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => { setPage(page - 1); setSelected(new Set()); }}>
            Previous
          </Button>
          <Typography variant="body2" color="text.secondary">
            Page {page} of {totalPages || 1}
          </Typography>
          <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => { setPage(page + 1); setSelected(new Set()); }}>
            Next
          </Button>
        </Stack>

        <Button
          variant="contained"
          startIcon={<SyncIcon />}
          onClick={handleSync}
          disabled={selected.size === 0 || syncMutation.isPending}
        >
          {syncMutation.isPending ? 'Syncing...' : `Sync ${selected.size} Selected`}
        </Button>
      </Stack>
    </Box>
  );
}
