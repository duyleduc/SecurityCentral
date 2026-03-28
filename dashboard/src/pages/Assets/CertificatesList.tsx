import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Chip, Stack, Select, MenuItem,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton,
} from '@mui/material';
import { useCertificates, type Certificate } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';

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
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const params: Record<string, string | number> = { page, per_page: 25 };
  if (statusFilter) params.status = statusFilter;

  const certs = useCertificates(params);
  const data = certs.data?.data as Certificate[] | undefined;
  const meta = certs.data?.meta;

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
              <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/assets/certificates/${c.id}`)}>
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
