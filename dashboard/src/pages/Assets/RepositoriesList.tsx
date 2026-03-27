import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Stack, Tabs, Tab,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton, Alert, Divider, LinearProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import BugReportIcon from '@mui/icons-material/BugReport';
import HistoryIcon from '@mui/icons-material/History';
import InfoIcon from '@mui/icons-material/Info';
import { useRepositories, useRepository, useTriggerScan, useFindings, useScans, type Repository } from '../../api/hooks.js';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../theme/theme.js';

export function RepositoriesList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const repos = useRepositories({ page, per_page: 25 });
  const data = repos.data?.data as Repository[] | undefined;
  const meta = repos.data?.meta;

  if (selectedId) return <RepositoryDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Repositories</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Repository</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Language</TableCell>
              <TableCell>Last Scan</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {repos.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={4} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>No repositories</TableCell>
              </TableRow>
            ) : data.map((r) => (
              <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedId(r.id)}>
                <TableCell sx={{ fontWeight: 500 }}>{r.owner}/{r.name}</TableCell>
                <TableCell>{r.provider}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{r.language ?? '-'}</TableCell>
                <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                  {r.lastScanAt ? new Date(r.lastScanAt).toLocaleString() : 'Never'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </Box>
  );
}

function RepositoryDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useRepository(id);
  const triggerScan = useTriggerScan();
  const [tab, setTab] = useState(0);

  // Fetch findings and scans for this repo
  const findings = useFindings({ repository_id: id, page: 1, per_page: 10 });
  const scans = useScans({ repository_id: id, page: 1, per_page: 10 });

  const repo = envelope?.data as Record<string, unknown> | undefined;
  const findingsData = (findings.data?.data ?? []) as any[];
  const scansData = (scans.data?.data ?? []) as any[];

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!repo) {
    return <Box sx={{ py: 5, textAlign: 'center' }}><Typography color="text.secondary">Not found</Typography></Box>;
  }

  const latestScan = repo.latestScan as Record<string, unknown> | null;
  const findingCounts = (repo.findingCounts ?? {}) as Record<string, number>;
  const totalFindings = Object.values(findingCounts).reduce((a, b) => a + b, 0);

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" onClick={onBack} sx={{ mb: 2 }}>
        Back to Repositories
      </Button>

      {/* Header card — repo info + trigger scan */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h5" sx={{ mb: 1 }}>{repo.owner as string}/{repo.name as string}</Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                <Chip label={repo.provider as string} size="small" variant="outlined" />
                <Chip label={`branch: ${repo.defaultBranch as string}`} size="small" variant="outlined" />
                {repo.language && <Chip label={repo.language as string} size="small" variant="outlined" />}
              </Stack>
            </Box>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => triggerScan.mutate(id)}
              disabled={triggerScan.isPending}
            >
              {triggerScan.isPending ? 'Scanning...' : 'Trigger Scan'}
            </Button>
          </Stack>

          {triggerScan.isError && <Alert severity="error" sx={{ mt: 1 }}>{(triggerScan.error as Error).message}</Alert>}
          {triggerScan.isSuccess && <Alert severity="success" sx={{ mt: 1 }}>Scan triggered successfully</Alert>}

          {/* Severity summary */}
          <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
            {['critical', 'high', 'medium', 'low'].map((sev) => (
              <Box key={sev} sx={{ textAlign: 'center', minWidth: 70 }}>
                <Typography variant="h5" sx={{ color: SEVERITY_COLORS[sev], fontWeight: 700 }}>
                  {findingCounts[sev] ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{sev}</Typography>
              </Box>
            ))}
            <Divider orientation="vertical" flexItem />
            <Box sx={{ textAlign: 'center', minWidth: 70 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{totalFindings}</Typography>
              <Typography variant="caption" color="text.secondary">Total</Typography>
            </Box>
          </Stack>

          {/* Latest scan status */}
          {latestScan && (
            <Box sx={{ mt: 2, bgcolor: 'background.default', borderRadius: 1, p: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" fontWeight={500}>Last scan:</Typography>
                <Chip label={latestScan.status as string} size="small" color={latestScan.status === 'completed' ? 'success' : latestScan.status === 'failed' ? 'error' : 'default'} />
                <Typography variant="body2" color="text.secondary">{latestScan.scanType as string}</Typography>
                {latestScan.completedAt && (
                  <Typography variant="body2" color="text.secondary">{new Date(latestScan.completedAt as string).toLocaleString()}</Typography>
                )}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Tabs: Findings | Scan History */}
      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tab icon={<BugReportIcon />} iconPosition="start" label={`Findings (${findings.data?.meta?.total ?? 0})`} />
          <Tab icon={<HistoryIcon />} iconPosition="start" label={`Scan History (${scans.data?.meta?.total ?? 0})`} />
        </Tabs>

        {/* Findings Tab */}
        {tab === 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Severity</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>CVE</TableCell>
                  <TableCell align="right">CVSS</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {findings.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 5 }).map((__, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>
                  ))
                ) : findingsData.length === 0 ? (
                  <TableRow><TableCell colSpan={5} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No findings — looking good!</TableCell></TableRow>
                ) : findingsData.map((f: any) => (
                  <TableRow key={f.id} hover>
                    <TableCell>
                      <Chip label={f.severity} size="small" sx={{ bgcolor: SEVERITY_COLORS[f.severity] ?? '#64748b', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }} />
                    </TableCell>
                    <TableCell>
                      <Link to={`/findings/${f.id}`} style={{ color: '#0f172a', textDecoration: 'none' }}>
                        {f.title?.length > 60 ? f.title.slice(0, 57) + '...' : f.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Chip label={f.status?.replace('_', ' ')} size="small" variant="outlined" sx={{ borderColor: STATUS_COLORS[f.status], color: STATUS_COLORS[f.status], fontSize: '0.7rem' }} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{f.cveId ?? '—'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{f.cvssScore ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {findingsData.length > 0 && (
              <Box sx={{ p: 1.5, textAlign: 'center' }}>
                <Button component={Link} to={`/findings?repository_id=${id}`} size="small">View all findings</Button>
              </Box>
            )}
          </TableContainer>
        )}

        {/* Scan History Tab */}
        {tab === 1 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell align="right">Findings</TableCell>
                  <TableCell align="right">Duration</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {scans.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((__, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>
                  ))
                ) : scansData.length === 0 ? (
                  <TableRow><TableCell colSpan={6} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No scans yet</TableCell></TableRow>
                ) : scansData.map((s: any) => (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Chip
                        label={s.status}
                        size="small"
                        color={s.status === 'completed' ? 'success' : s.status === 'failed' ? 'error' : s.status === 'running' ? 'info' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{s.scanType}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{s.trigger}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{s.startedAt ? new Date(s.startedAt).toLocaleString() : '—'}</TableCell>
                    <TableCell align="right">
                      {s.findingsTotal > 0 ? (
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Typography variant="body2" fontWeight={500}>{s.findingsTotal}</Typography>
                          {s.findingsNew > 0 && <Chip label={`+${s.findingsNew}`} size="small" color="error" sx={{ height: 20, fontSize: '0.65rem' }} />}
                        </Stack>
                      ) : '0'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                      {s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}

export function Pagination({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / perPage);
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
      <Typography variant="body2" color="text.secondary">Page {page} of {totalPages}</Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </Stack>
    </Stack>
  );
}
