import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, Stack, Paper, Skeleton, Alert, Divider,
  IconButton, Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderIcon from '@mui/icons-material/Folder';
import LanguageIcon from '@mui/icons-material/Language';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useCertificate } from '../../api/hooks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CERT_STATUS: Record<string, { color: string; label: string }> = {
  active: { color: '#16a34a', label: 'Active' },
  expiring: { color: '#f59e0b', label: 'Expiring' },
  expired: { color: '#dc2626', label: 'Expired' },
  revoked: { color: '#9e9e9e', label: 'Revoked' },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#d32f2f', high: '#f44336', medium: '#ff9800', low: '#2196f3', info: '#9e9e9e',
};

function daysUntilExpiry(notAfter: string): number {
  return Math.floor((new Date(notAfter).getTime() - Date.now()) / 86400000);
}

function expiryLabel(days: number): string {
  if (days <= 0) return `Expired ${Math.abs(days)} days ago`;
  return `${days} days remaining`;
}

function expiryColor(days: number): string {
  if (days <= 0) return '#dc2626';
  if (days <= 30) return '#dc2626';
  if (days <= 90) return '#f59e0b';
  return '#16a34a';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CertificateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: envelope, isLoading } = useCertificate(id ?? '');
  const cert = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={80} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={200} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={150} />
      </Box>
    );
  }

  if (!cert) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>Back</Button>
        <Alert severity="error">Certificate not found</Alert>
      </Box>
    );
  }

  const status = CERT_STATUS[cert.status as string] ?? { color: '#9e9e9e', label: cert.status as string };
  const days = daysUntilExpiry(cert.notAfter as string);
  const sans = (cert.sans ?? []) as string[];
  const findings = (cert.findings ?? []) as Array<Record<string, unknown>>;
  const endpoint = cert.endpoint as { id: string; host: string; port: number; project: { id: string; name: string } | null } | null;

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {cert.subjectCn as string}
            </Typography>
            <Chip label={status.label} size="small" sx={{ bgcolor: status.color, color: '#fff', fontWeight: 600 }} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ ml: 0 }}>
            Issued by {cert.issuerCn as string}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {endpoint?.project && (
            <Chip
              icon={<FolderIcon />}
              label={endpoint.project.name}
              variant="outlined"
              component={Link}
              to={`/projects/${endpoint.project.id}`}
              clickable
            />
          )}
          {endpoint && (
            <Chip
              icon={<LanguageIcon />}
              label={`${endpoint.host}${endpoint.port !== 443 ? `:${endpoint.port}` : ''}`}
              variant="outlined"
              component={Link}
              to={`/monitoring/domains/${endpoint.id}`}
              clickable
            />
          )}
        </Stack>
      </Stack>

      {/* Expiry banner */}
      <Paper
        variant="outlined"
        sx={{
          p: 2, mb: 3,
          borderColor: expiryColor(days),
          bgcolor: days <= 30 ? `${expiryColor(days)}10` : undefined,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={2}>
          {days <= 0 ? (
            <ErrorIcon sx={{ color: '#dc2626', fontSize: 32 }} />
          ) : days <= 30 ? (
            <WarningAmberIcon sx={{ color: '#f59e0b', fontSize: 32 }} />
          ) : (
            <CheckCircleIcon sx={{ color: '#16a34a', fontSize: 32 }} />
          )}
          <Box>
            <Typography variant="h6" sx={{ color: expiryColor(days), fontWeight: 700 }}>
              {expiryLabel(days)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Expires {new Date(cert.notAfter as string).toLocaleDateString()} | Valid from {new Date(cert.notBefore as string).toLocaleDateString()}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Info cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        <InfoCard label="Key Algorithm" value={cert.keyAlgorithm as string} />
        <InfoCard label="Signature" value={(cert.signatureAlgorithm as string) ?? '--'} />
        <InfoCard label="Chain Valid" value={cert.chainValid != null ? (cert.chainValid ? 'Yes' : 'No') : '--'} />
        <InfoCard label="Chain Depth" value={cert.chainDepth != null ? String(cert.chainDepth) : '--'} />
        <InfoCard label="Source" value={(cert.discoveredFrom as string) ?? '--'} />
        <InfoCard label="Last Checked" value={cert.lastCheckedAt ? new Date(cert.lastCheckedAt as string).toLocaleString() : '--'} />
      </Box>

      {/* Serial + Fingerprint */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" color="text.secondary">Serial Number</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
              {cert.serialNumber as string}
            </Typography>
          </Box>
          <Divider />
          <Box>
            <Typography variant="caption" color="text.secondary">Fingerprint (SHA-256)</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
              {cert.fingerprintSha256 as string}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* SANs */}
      {sans.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Subject Alternative Names ({sans.length})</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {sans.map((san) => (
              <Chip key={san} label={san} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
            ))}
          </Stack>
        </Paper>
      )}

      {/* Related findings */}
      {findings.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Related Findings ({findings.length})</Typography>
          <Stack spacing={0.5}>
            {findings.map((f) => (
              <Stack
                key={f.id as string}
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ py: 0.75, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <Chip
                  label={f.severity as string}
                  size="small"
                  sx={{
                    bgcolor: SEVERITY_COLOR[f.severity as string] ?? '#9e9e9e',
                    color: '#fff',
                    fontWeight: 600,
                    minWidth: 64,
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 500, flex: 1 }}>{f.title as string}</Typography>
                <Chip label={f.status as string} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {findings.length === 0 && (
        <Paper sx={{ py: 3, textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 32, color: 'success.main', mb: 1 }} />
          <Typography color="text.secondary">No open findings for this certificate</Typography>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>{value}</Typography>
    </Paper>
  );
}
