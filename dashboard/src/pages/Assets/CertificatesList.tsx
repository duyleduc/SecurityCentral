import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Chip, Stack, Select, MenuItem, Divider, Button,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useCertificates, useCertificate, type Certificate } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';
import { SEVERITY_COLORS } from '../../theme/theme.js';

function expiryColor(notAfter: string): string {
  const days = Math.floor((new Date(notAfter).getTime() - Date.now()) / 86400000);
  if (days <= 30) return '#dc2626';
  if (days <= 90) return '#ca8a04';
  return '#16a34a';
}

function daysUntil(notAfter: string): string {
  const days = Math.floor((new Date(notAfter).getTime() - Date.now()) / 86400000);
  if (days <= 0) return 'Expired';
  return `${days}d`;
}

const CERT_STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  active: 'success',
  expired: 'error',
  expiring: 'warning',
  revoked: 'default',
};

export function CertificatesList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const params: Record<string, string | number> = { page, per_page: 25 };
  if (statusFilter) params.status = statusFilter;

  const certs = useCertificates(params);
  const data = certs.data?.data as Certificate[] | undefined;
  const meta = certs.data?.meta;

  if (selectedId) return <CertificateDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Certificates</Typography>

      <Box sx={{ mb: 2 }}>
        <Select
          size="small"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          displayEmpty
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All Statuses</MenuItem>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="expiring">Expiring</MenuItem>
          <MenuItem value="expired">Expired</MenuItem>
          <MenuItem value="revoked">Revoked</MenuItem>
        </Select>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Subject</TableCell>
              <TableCell>Issuer</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Algorithm</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {certs.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.length ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>No certificates</TableCell>
              </TableRow>
            ) : data.map((c) => (
              <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedId(c.id)}>
                <TableCell sx={{ fontWeight: 500 }}>{c.subjectCn}</TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{c.issuerCn}</TableCell>
                <TableCell>
                  <Typography component="span" variant="body2" sx={{ color: expiryColor(c.notAfter), fontWeight: 600 }}>
                    {daysUntil(c.notAfter)}
                  </Typography>
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {new Date(c.notAfter).toLocaleDateString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={c.status} size="small" color={CERT_STATUS_COLOR[c.status] ?? 'default'} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{c.keyAlgorithm}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </Box>
  );
}

function CertificateDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useCertificate(id);
  const cert = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={250} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!cert) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography color="text.secondary">Not found</Typography>
      </Box>
    );
  }

  const sans = (cert.sans ?? []) as string[];
  const findings = (cert.findings ?? []) as Array<Record<string, unknown>>;

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} size="small" onClick={onBack} sx={{ mb: 2 }}>
        Back to Certificates
      </Button>
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>{cert.subjectCn as string}</Typography>

          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Issuer</Typography>
              <Typography variant="body2">{cert.issuerCn as string}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Serial</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{cert.serialNumber as string}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Not Before</Typography>
              <Typography variant="body2">{cert.notBefore ? new Date(cert.notBefore as string).toLocaleString() : '-'}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Not After</Typography>
              <Typography variant="body2" sx={{ color: expiryColor(cert.notAfter as string), fontWeight: 600 }}>
                {new Date(cert.notAfter as string).toLocaleString()}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Key Algorithm</Typography>
              <Typography variant="body2">{cert.keyAlgorithm as string}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Signature</Typography>
              <Typography variant="body2">{(cert.signatureAlgorithm as string) ?? '-'}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Chain Valid</Typography>
              <Typography variant="body2">{cert.chainValid != null ? (cert.chainValid ? 'Yes' : 'No') : '-'}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Chain Depth</Typography>
              <Typography variant="body2">{cert.chainDepth != null ? String(cert.chainDepth) : '-'}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Fingerprint</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.625rem' }}>
                {(cert.fingerprintSha256 as string)?.slice(0, 32)}...
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Source</Typography>
              <Typography variant="body2">{(cert.discoveredFrom as string) ?? '-'}</Typography>
            </Grid>
          </Grid>

          {/* SANs */}
          {sans.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Subject Alternative Names ({sans.length})</Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75}>
                {sans.map((san) => (
                  <Chip key={san} label={san} size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
                ))}
              </Stack>
            </Box>
          )}

          {/* Related findings */}
          {findings.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Related Findings</Typography>
              {findings.map((f) => (
                <Box key={f.id as string} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>{f.title as string}</Typography>
                  <Typography variant="body2" component="span" color="text.secondary" sx={{ ml: 1 }}>
                    ({f.severity as string})
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
