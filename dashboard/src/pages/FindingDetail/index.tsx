import { Link } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Button, Alert, Skeleton, Stack, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useFinding, useUpdateFinding } from '../../api/hooks.js';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../theme/theme.js';

const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'resolved', 'suppressed', 'false_positive'],
  in_progress: ['resolved', 'suppressed', 'false_positive'],
  resolved: ['open'],
  suppressed: ['open'],
  false_positive: ['open'],
};
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', suppressed: 'Suppressed', false_positive: 'False Positive' };

export function FindingDetail({ findingId }: { findingId: string }) {
  const { data: envelope, isLoading } = useFinding(findingId);
  const updateMutation = useUpdateFinding();
  const finding = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!finding) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography color="text.secondary">Finding not found</Typography>
      </Box>
    );
  }

  const severity = finding.severity as string;
  const status = finding.status as string;
  const transitions = STATUS_TRANSITIONS[status] ?? [];
  const detail = (finding.detail ?? {}) as Record<string, unknown>;

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({ id: findingId, status: newStatus });
  };

  return (
    <Box>
      <Button
        component={Link}
        to="/findings"
        startIcon={<ArrowBackIcon />}
        size="small"
        sx={{ mb: 2 }}
      >
        Back to Findings
      </Button>

      <Card>
        <CardContent sx={{ p: 3 }}>
          {/* Header */}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
            <Box>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Chip
                  label={severity}
                  size="small"
                  sx={{
                    bgcolor: SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info,
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}
                />
                <Chip
                  label={STATUS_LABEL[status]}
                  size="small"
                  variant="outlined"
                  sx={{
                    borderColor: STATUS_COLORS[status] ?? STATUS_COLORS.open,
                    color: STATUS_COLORS[status] ?? STATUS_COLORS.open,
                  }}
                />
              </Stack>
              <Typography variant="h6">{finding.title as string}</Typography>
            </Box>

            {/* Status actions */}
            <Stack direction="row" spacing={1}>
              {transitions.map((s) => (
                <Button
                  key={s}
                  variant="outlined"
                  size="small"
                  onClick={() => handleStatusChange(s)}
                  disabled={updateMutation.isPending}
                >
                  {STATUS_LABEL[s]}
                </Button>
              ))}
            </Stack>
          </Stack>

          {/* Info grid */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <InfoItem label="CVE ID" value={finding.cveId as string} mono />
            <InfoItem label="CVSS Score" value={finding.cvssScore != null ? String(finding.cvssScore) : 'N/A'} />
            <InfoItem label="CVSS Vector" value={(finding.cvssVector as string) ?? 'N/A'} mono />
            <InfoItem label="Source" value={finding.source as string} />
            <InfoItem label="First Seen" value={finding.firstSeenAt ? new Date(finding.firstSeenAt as string).toLocaleString() : 'N/A'} />
            <InfoItem label="Resolved At" value={finding.resolvedAt ? new Date(finding.resolvedAt as string).toLocaleString() : '-'} />
            <InfoItem label="Auto-fixable" value={(finding.autoFixable as boolean) ? 'Yes' : 'No'} />
            {finding.fixPrUrl && (
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
                  Fix PR
                </Typography>
                <Button
                  href={finding.fixPrUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  endIcon={<OpenInNewIcon />}
                >
                  {finding.fixPrUrl as string}
                </Button>
              </Grid>
            )}
          </Grid>

          <Divider sx={{ mb: 3 }} />

          {/* Description */}
          {finding.description && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Description</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.6 }}>{finding.description as string}</Typography>
            </Box>
          )}

          {/* Remediation */}
          {finding.remediation && (
            <Alert severity="success" sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Remediation</Typography>
              <Typography variant="body2">{finding.remediation as string}</Typography>
            </Alert>
          )}

          {/* Detail (package info etc) */}
          {Object.keys(detail).length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Details</Typography>
              <Box sx={{ bgcolor: 'background.default', borderRadius: 1, p: 2, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {Object.entries(detail).map(([k, v]) => (
                  <Box key={k} sx={{ mb: 0.5 }}>
                    <Typography component="span" variant="body2" color="text.secondary">{k}:</Typography>{' '}
                    <Typography component="span" variant="body2">{String(v)}</Typography>
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
    <Grid item xs={6}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: mono ? 'monospace' : 'inherit' }}>
        {value ?? '-'}
      </Typography>
    </Grid>
  );
}
