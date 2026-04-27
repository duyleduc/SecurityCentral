import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, IconButton, InputAdornment,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Chip, Stack, TextField,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import GitHubIcon from '@mui/icons-material/GitHub';
import CodeIcon from '@mui/icons-material/Code';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useRepositories, type Repository } from '../../api/hooks';
import { HealthChip } from '../../components/status';
import { StatusPill } from '../../components/design';
import { useProjectScope } from '../../lib/useProjectScope';
import type { Health } from '../../lib/status';

/** Narrowed health type for the repos list — 'unknown' doesn't apply here. */
type RepoBucket = 'healthy' | 'at-risk' | 'critical' | 'unscanned';

/**
 * Derive a coarse health bucket from open findings count + scan status.
 * The list endpoint doesn't expose severity breakdown, so we use total count
 * thresholds as a proxy. Real severity drives the per-repo grade on the detail page.
 */
function healthFromRepo(r: Repository): RepoBucket {
  if (r.lastScanAt === null) return 'unscanned';
  const count = r._count?.findings ?? 0;
  if (count === 0) return 'healthy';
  if (count >= 5) return 'critical';
  return 'at-risk';
}

export function RepositoriesPage() {
  const { projectId } = useProjectScope();
  const { data: repos, isLoading } = useRepositories(projectId ?? undefined);
  const navigate = useNavigate();
  const [healthFilter, setHealthFilter] = useState<RepoBucket | null>(null);
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const buckets: Record<RepoBucket, number> = { healthy: 0, 'at-risk': 0, critical: 0, unscanned: 0 };
    for (const r of repos ?? []) {
      buckets[healthFromRepo(r)] += 1;
    }
    return buckets;
  }, [repos]);

  const filtered = useMemo(() => {
    return (repos ?? []).filter((r) => {
      if (healthFilter && healthFromRepo(r) !== healthFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = `${r.owner}/${r.name} ${r.language ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [repos, healthFilter, search]);

  const toggle = (h: RepoBucket) =>
    setHealthFilter((prev) => (prev === h ? null : h));

  const total = repos?.length ?? 0;
  const hasFilters = !!healthFilter || !!search;
  const clearAll = () => { setHealthFilter(null); setSearch(''); };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4">Repositories</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Code scanning across connected providers ·{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
              {total} {total === 1 ? 'repo' : 'repos'}
            </Box>
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<SettingsIcon />} onClick={() => navigate('/settings')}>
          Manage Integrations
        </Button>
      </Stack>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.25, px: 1.75, '&:last-child': { pb: 1.25 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <StatusPill label="All" count={total} active={healthFilter === null} onClick={() => setHealthFilter(null)} />
              <StatusPill label="Healthy" color="#22c55e" count={counts.healthy} active={healthFilter === 'healthy'} onClick={() => toggle('healthy')} />
              <StatusPill label="At-risk" color="#f59e0b" count={counts['at-risk']} active={healthFilter === 'at-risk'} onClick={() => toggle('at-risk')} />
              <StatusPill label="Critical" color="#ef4444" count={counts.critical} active={healthFilter === 'critical'} onClick={() => toggle('critical')} />
              <StatusPill label="Unscanned" color="#94a3b8" count={counts.unscanned} active={healthFilter === 'unscanned'} onClick={() => toggle('unscanned')} />
            </Stack>

            <Box sx={{ flex: 1 }} />

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small" placeholder="Search owner/name or language" value={search}
                onChange={(e) => setSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <IconButton size="small" onClick={() => setSearch('')}>
                        <ClearIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    ) : null,
                  },
                }}
                sx={{ width: 280 }}
              />
              {hasFilters && (
                <Button size="small" onClick={clearAll} sx={{ textTransform: 'none', color: 'text.secondary' }}>
                  Clear
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Repository</TableCell>
              <TableCell>Health</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Language</TableCell>
              <TableCell>Findings</TableCell>
              <TableCell>Last Scan</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !filtered?.length ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                  {repos?.length === 0
                    ? 'No repositories imported yet. Go to Settings to connect a provider and import repos.'
                    : 'No repositories match the current filter.'}
                </TableCell>
              </TableRow>
            ) : filtered.map((r: Repository) => {
              const h = healthFromRepo(r);
              const findings = r._count?.findings ?? 0;
              return (
                <TableRow
                  key={r.id} hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/repositories/${r.id}`)}
                >
                  <TableCell sx={{ fontWeight: 500 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {r.provider === 'github' ? <GitHubIcon fontSize="small" /> : <CodeIcon fontSize="small" />}
                      <span>{r.owner}/{r.name}</span>
                      {r.project && (
                        <Chip label={r.project.name} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18, ml: 1 }} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {h === 'unscanned'
                      ? <Chip label="unscanned" size="small" variant="outlined" />
                      : <HealthChip health={h as Health} />}
                  </TableCell>
                  <TableCell>
                    <Chip label={r.provider} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{r.language ?? '-'}</TableCell>
                  <TableCell>
                    {findings > 0 ? (
                      <Chip
                        label={`${findings} open`}
                        size="small"
                        color={h === 'critical' ? 'error' : 'warning'}
                        variant="outlined"
                      />
                    ) : h === 'unscanned' ? (
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">0</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                    {r.lastScanAt ? new Date(r.lastScanAt).toLocaleString() : 'Never'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
