import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Chip, Button, Alert, Skeleton, Stack, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Link as MuiLink,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { useFinding, useUpdateFinding } from '../../api/hooks';
import { WorkStateChip } from '../../components/status';
import { workStateFromFindingStatus, type WorkState } from '../../lib/status';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#22d3ee', low: '#94a3b8', info: '#94a3b8',
};

/** Work-state UI → backend `status` string. */
const WORK_STATE_TO_STATUS: Record<WorkState, string> = {
  new: 'open',
  'in-progress': 'in_progress',
  resolved: 'resolved',
  dismissed: 'ignored',
};

const DISMISS_REASONS = [
  { value: 'not-a-risk', label: 'Not a risk' },
  { value: 'accepted', label: 'Accepted risk' },
  { value: 'wont-fix', label: "Won't fix" },
];

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function FindingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: finding, isLoading } = useFinding(id ?? '');
  const updateMutation = useUpdateFinding();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState<string>('not-a-risk');

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/findings');
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!finding) {
    return <Box sx={{ py: 5, textAlign: 'center' }}><Typography color="text.secondary">Finding not found</Typography></Box>;
  }

  const severity = finding.severity;
  const workState = workStateFromFindingStatus(finding.status);
  const detail = ((finding as unknown as { detail?: Record<string, unknown> | null }).detail ?? {}) as Record<string, unknown>;
  const epss = detail.epss as number | undefined;
  const isKev = detail.cisaKev === true;
  const remediation = detail.remediation as string | undefined;
  const fixedVersion = detail.fixedVersion as string | undefined;
  const packageName = detail.packageName as string | undefined;
  const installedVersion = detail.installedVersion as string | undefined;
  const filePath = detail.file as string | undefined;
  const lineNumber = detail.line as number | undefined;
  const dismissReasonSaved = detail.dismissReason as string | undefined;

  const setWorkState = (next: WorkState) => {
    updateMutation.mutate({ id: id!, status: WORK_STATE_TO_STATUS[next] });
  };

  const confirmDismiss = () => {
    updateMutation.mutate({ id: id!, status: 'ignored' });
    setDismissOpen(false);
  };

  return (
    <Box>
      <Button onClick={handleBack} startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Back
      </Button>

      {/* === Header card — severity/state/KEV/EPSS/CVSS chips, title, subtext === */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip
              label={severity}
              size="small"
              sx={{ bgcolor: SEVERITY_COLORS[severity] ?? '#6b7280', color: '#fff', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}
            />
            <WorkStateChip state={workState} />
            {isKev && (
              <Chip label="KEV" size="small" color="error" variant="filled" sx={{ fontWeight: 700, letterSpacing: 0.5 }} />
            )}
            {epss != null && (
              <Chip
                label={`EPSS ${(epss * 100).toFixed(1)}%`}
                size="small"
                variant="outlined"
                sx={{ color: epss >= 0.5 ? 'error.main' : epss >= 0.1 ? 'warning.main' : 'text.secondary' }}
              />
            )}
            {finding.cvssScore != null && (
              <Chip label={`CVSS ${finding.cvssScore.toFixed(1)}`} size="small" variant="outlined" />
            )}
            {workState === 'dismissed' && dismissReasonSaved && (
              <Chip
                label={`reason: ${DISMISS_REASONS.find((r) => r.value === dismissReasonSaved)?.label ?? dismissReasonSaved}`}
                size="small"
                variant="outlined"
              />
            )}
          </Stack>

          {finding.cveId && (
            <Typography variant="h4" sx={{ fontFamily: 'monospace', mb: 0.5, fontWeight: 600 }}>
              {finding.cveId}
            </Typography>
          )}
          <Typography variant="h6" sx={{ fontWeight: 500, mb: 0.5 }}>
            {finding.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {finding.repository && (
              <>
                Detected on{' '}
                <MuiLink
                  component="button"
                  type="button"
                  onClick={() => navigate(`/repositories/${finding.repository!.id}`)}
                  sx={{ fontWeight: 600 }}
                >
                  {finding.repository.owner}/{finding.repository.name}
                </MuiLink>
              </>
            )}
            {finding.server && (
              <>
                Detected on{' '}
                <MuiLink
                  component="button"
                  type="button"
                  onClick={() => navigate(`/servers/${finding.server!.id}`)}
                  sx={{ fontWeight: 600 }}
                >
                  {finding.server.hostname}
                </MuiLink>
              </>
            )}
            {' · first seen '}{relativeTime(finding.createdAt)}
            {' · source: '}<Box component="span" sx={{ fontFamily: 'monospace' }}>{finding.source}</Box>
          </Typography>
        </CardContent>
      </Card>

      {updateMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>{(updateMutation.error as Error).message}</Alert>
      )}

      {/* === 2-col layout: main content (left, wider) + sidebar (right) === */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {/* LEFT — Description, Remediation, Evidence */}
        <Stack spacing={2}>
          {finding.description && (
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>Description</Typography>
                <Typography variant="body2" sx={{ lineHeight: 1.7, color: 'text.secondary' }}>
                  {finding.description}
                </Typography>
              </CardContent>
            </Card>
          )}

          {(remediation || fixedVersion) && (
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                  <LightbulbIcon fontSize="small" sx={{ color: 'warning.main' }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Remediation</Typography>
                </Stack>
                {remediation && (
                  <Box
                    sx={{
                      bgcolor: 'background.default',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1.5,
                      fontFamily: 'monospace',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      mb: fixedVersion ? 1 : 0,
                    }}
                  >
                    {remediation}
                  </Box>
                )}
                {fixedVersion && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Fixed in version <Box component="span" sx={{ fontFamily: 'monospace', color: 'success.main', fontWeight: 600 }}>{fixedVersion}</Box>
                  </Typography>
                )}
                {finding.repository && (
                  <Button size="small" variant="contained" sx={{ mt: 1.5 }}>
                    Open automated PR
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {(packageName || filePath) && (
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                  <FactCheckIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Evidence</Typography>
                </Stack>
                <Box sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary', lineHeight: 1.9 }}>
                  {packageName && (
                    <Box>
                      Package: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{packageName}</Box>
                      {installedVersion ? ` @ ${installedVersion}` : ''}
                    </Box>
                  )}
                  {filePath && (
                    <Box>
                      File: <Box component="span" sx={{ color: 'text.primary' }}>{filePath}{lineNumber != null ? `:${lineNumber}` : ''}</Box>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Fallback: raw detail blob if no structured data matched above */}
          {!finding.description && !remediation && !packageName && !filePath && Object.keys(detail).length > 0 && (
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>Details</Typography>
                <Box sx={{ bgcolor: 'background.default', borderRadius: 1, p: 2, fontFamily: 'monospace', fontSize: 12 }}>
                  {Object.entries(detail).map(([k, v]) => (
                    <Box key={k} sx={{ mb: 0.5 }}>
                      <Typography component="span" variant="body2" color="text.secondary">{k}:</Typography>{' '}
                      <Typography component="span" variant="body2">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '-')}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}
        </Stack>

        {/* RIGHT sidebar — Actions, Timeline, References */}
        <Stack spacing={2} sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>Actions</Typography>
              <Stack spacing={1}>
                {workState !== 'in-progress' && workState !== 'resolved' && (
                  <Button
                    size="small"
                    variant="outlined"
                    fullWidth
                    startIcon={<PlayArrowIcon />}
                    disabled={updateMutation.isPending}
                    onClick={() => setWorkState('in-progress')}
                    sx={{ borderColor: 'warning.main', color: 'warning.main' }}
                  >
                    Mark in-progress
                  </Button>
                )}
                {workState !== 'resolved' && (
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    fullWidth
                    startIcon={<CheckCircleIcon />}
                    disabled={updateMutation.isPending}
                    onClick={() => setWorkState('resolved')}
                  >
                    Mark resolved
                  </Button>
                )}
                {workState !== 'dismissed' && (
                  <Button
                    size="small"
                    variant="outlined"
                    fullWidth
                    startIcon={<CancelIcon />}
                    disabled={updateMutation.isPending}
                    onClick={() => setDismissOpen(true)}
                    sx={{ borderColor: 'text.secondary', color: 'text.secondary' }}
                  >
                    Dismiss…
                  </Button>
                )}
                {(workState === 'resolved' || workState === 'dismissed') && (
                  <Button
                    size="small"
                    variant="outlined"
                    fullWidth
                    disabled={updateMutation.isPending}
                    onClick={() => setWorkState('new')}
                  >
                    Reopen
                  </Button>
                )}
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6, display: 'block' }}>
                Dismissing requires a reason:
                <br />not-a-risk · accepted · won't fix
              </Typography>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>Timeline</Typography>
              <Stack spacing={0.75} sx={{ fontSize: 12, color: 'text.secondary' }}>
                <Box>● {relativeTime(finding.createdAt)} · Detected during scan</Box>
                {workState === 'in-progress' && <Box>● now · Marked in-progress</Box>}
                {workState === 'resolved' && <Box>● now · Marked resolved</Box>}
                {workState === 'dismissed' && <Box>● now · Dismissed</Box>}
                {workState === 'new' && <Typography variant="caption" color="text.disabled">… waiting for action</Typography>}
              </Stack>
            </CardContent>
          </Card>

          {finding.cveId && (
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 600 }}>References</Typography>
                <Stack spacing={0.75}>
                  <MuiLink
                    href={finding.cveId.startsWith('CVE-')
                      ? `https://nvd.nist.gov/vuln/detail/${finding.cveId}`
                      : `https://osv.dev/vulnerability/${finding.cveId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12 }}
                  >
                    {finding.cveId.startsWith('CVE-') ? 'nvd.nist.gov' : 'osv.dev'} <OpenInNewIcon sx={{ fontSize: 12 }} />
                  </MuiLink>
                  {isKev && (
                    <MuiLink
                      href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12 }}
                    >
                      CISA KEV catalog <OpenInNewIcon sx={{ fontSize: 12 }} />
                    </MuiLink>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Box>

      {/* Dismiss dialog */}
      <Dialog open={dismissOpen} onClose={() => setDismissOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Dismiss this finding</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Dismissing closes the finding without action. Pick a reason so future scans and teammates know why.
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>Reason</InputLabel>
            <Select value={dismissReason} label="Reason" onChange={(e) => setDismissReason(e.target.value)}>
              {DISMISS_REASONS.map((r) => (
                <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDismissOpen(false)} disabled={updateMutation.isPending}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDismiss}
            disabled={updateMutation.isPending}
          >
            Dismiss
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
