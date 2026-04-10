import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button, Alert, Skeleton, Stack, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useFinding, useUpdateFinding, type Finding } from '../../api/hooks';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#6b7280',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#dc2626', in_progress: '#f59e0b', resolved: '#16a34a', suppressed: '#64748b', false_positive: '#0ea5e9',
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'resolved', 'suppressed', 'false_positive'],
  in_progress: ['resolved', 'suppressed', 'false_positive'],
  resolved: ['open'],
  suppressed: ['open'],
  false_positive: ['open'],
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', suppressed: 'Suppressed', false_positive: 'False Positive',
};

export function FindingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: finding, isLoading } = useFinding(id ?? '');
  const updateMutation = useUpdateFinding();

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
  const status = finding.status;
  const transitions = STATUS_TRANSITIONS[status] ?? [];
  const detail = (finding as any).detail as Record<string, unknown> | null;

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({ id: id!, status: newStatus });
  };

  return (
    <Box>
      <Button onClick={handleBack} startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 2 }}>
        Back
      </Button>

      <Card>
        <CardContent sx={{ p: 3 }}>
          {/* Header: severity + status chips, status action buttons */}
          <Stack sx={{ mb: 3 }} spacing={1.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1}>
                <Chip
                  label={severity}
                  size="small"
                  sx={{ bgcolor: SEVERITY_COLORS[severity] ?? '#6b7280', color: '#fff', textTransform: 'uppercase' }}
                />
                <Chip
                  label={STATUS_LABEL[status] ?? status}
                  size="small"
                  variant="outlined"
                  sx={{ borderColor: STATUS_COLORS[status] ?? '#64748b', color: STATUS_COLORS[status] ?? '#64748b' }}
                />
              </Stack>

              <Stack direction="row" spacing={1}>
                {transitions.map((s) => (
                  <Button
                    key={s}
                    variant={s === 'resolved' ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => handleStatusChange(s)}
                    disabled={updateMutation.isPending}
                    sx={{
                      ...(s === 'resolved' && { bgcolor: '#16a34a', color: '#fff', '&:hover': { bgcolor: '#15803d' } }),
                      ...(s === 'suppressed' && { borderColor: '#64748b', color: '#64748b' }),
                      ...(s === 'false_positive' && { borderColor: '#0ea5e9', color: '#0ea5e9' }),
                      ...(s === 'in_progress' && { borderColor: '#f59e0b', color: '#f59e0b' }),
                      ...(s === 'open' && { borderColor: '#dc2626', color: '#dc2626' }),
                    }}
                  >
                    {STATUS_LABEL[s]}
                  </Button>
                ))}
              </Stack>
            </Stack>

            <Typography variant="h6">{finding.title}</Typography>
          </Stack>

          {updateMutation.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>{(updateMutation.error as Error).message}</Alert>
          )}
          {updateMutation.isSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>Status updated</Alert>
          )}

          {/* Info grid */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <InfoItem label="CVE ID" value={finding.cveId} mono />
            <InfoItem label="CVSS Score" value={finding.cvssScore != null ? String(finding.cvssScore) : null} />
            <InfoItem label="Source" value={finding.source} />
            <InfoItem label="Created" value={finding.createdAt ? new Date(finding.createdAt).toLocaleString() : null} />
            {finding.repository && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                  Repository
                </Typography>
                <Button
                  size="small"
                  onClick={() => navigate(`/repositories/${finding.repository!.id}`)}
                >
                  {finding.repository.owner}/{finding.repository.name}
                </Button>
              </Grid>
            )}
            {finding.server && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                  Server
                </Typography>
                <Button
                  size="small"
                  onClick={() => navigate(`/servers/${finding.server!.id}`)}
                >
                  {finding.server.hostname}
                </Button>
              </Grid>
            )}
          </Grid>

          <Divider sx={{ mb: 3 }} />

          {/* Description */}
          {finding.description && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Description</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.6 }}>{finding.description}</Typography>
            </Box>
          )}

          {/* Detail (package info, file location, etc.) */}
          {detail && Object.keys(detail).length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Details</Typography>
              <Box sx={{ bgcolor: 'background.default', borderRadius: 1, p: 2, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {Object.entries(detail).map(([k, v]) => (
                  <Box key={k} sx={{ mb: 0.5 }}>
                    <Typography component="span" variant="body2" color="text.secondary">{k}:</Typography>{' '}
                    <Typography component="span" variant="body2">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '-')}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function InfoItem({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: mono ? 'monospace' : 'inherit' }}>
        {value ?? '-'}
      </Typography>
    </Grid>
  );
}
