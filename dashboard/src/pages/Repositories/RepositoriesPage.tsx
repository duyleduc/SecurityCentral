import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, CardActionArea, Grid,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Chip, Stack,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import GitHubIcon from '@mui/icons-material/GitHub';
import CodeIcon from '@mui/icons-material/Code';
import { useRepositories, type Repository } from '../../api/hooks';
import { HealthChip } from '../../components/status';
import { ScopeBanner } from '../../components/ScopeBanner';
import { StatCard } from '../../components/design';
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

  const counts = useMemo(() => {
    const buckets: Record<RepoBucket, number> = { healthy: 0, 'at-risk': 0, critical: 0, unscanned: 0 };
    for (const r of repos ?? []) {
      buckets[healthFromRepo(r)] += 1;
    }
    return buckets;
  }, [repos]);

  const filtered = useMemo(() => {
    if (!healthFilter) return repos ?? [];
    return (repos ?? []).filter((r) => healthFromRepo(r) === healthFilter);
  }, [repos, healthFilter]);

  const toggle = (h: RepoBucket) =>
    setHealthFilter((prev) => (prev === h ? null : h));

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Repositories</Typography>
        <Button
          variant="contained"
          startIcon={<SettingsIcon />}
          onClick={() => navigate('/settings')}
        >
          Manage Integrations
        </Button>
      </Box>

      <ScopeBanner summary={`${repos?.length ?? 0} repositories in scope`} />

      {/* Summary cards — click to filter */}
      <Grid container spacing={2} mb={3}>
        {([
          { label: '● Healthy',   value: counts.healthy,    color: 'success' as const, key: 'healthy'   as RepoBucket },
          { label: '● At-risk',   value: counts['at-risk'], color: 'warning' as const, key: 'at-risk'   as RepoBucket },
          { label: '● Critical',  value: counts.critical,   color: 'error'   as const, key: 'critical'  as RepoBucket },
          { label: '○ Unscanned', value: counts.unscanned,  color: 'muted'   as const, key: 'unscanned' as RepoBucket },
        ]).map((s) => {
          const active = healthFilter === s.key;
          return (
            <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
              <StatCard
                value={s.value}
                label={active ? `${s.label} · filtering` : s.label}
                color={s.color}
                active={active}
                onClick={() => toggle(s.key)}
              />
            </Grid>
          );
        })}
      </Grid>

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
