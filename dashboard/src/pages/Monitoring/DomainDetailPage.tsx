import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { useEndpoint, useHeartbeats, useTriggerCheck } from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';

function DnsStatus({ label, value }: { label: string; value: string | null }) {
  const isPass = value === 'pass';
  return (
    <Box display="flex" alignItems="center" gap={1}>
      {isPass ? <CheckCircleIcon color="success" fontSize="small" /> : <CancelIcon color="error" fontSize="small" />}
      <Typography variant="body2">
        {label}: {isPass ? 'OK' : 'Missing'}
      </Typography>
    </Box>
  );
}

export function DomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: endpoint, isLoading } = useEndpoint(id ?? '');
  const { data: heartbeats } = useHeartbeats(id ?? '', 20);
  const triggerCheck = useTriggerCheck();

  if (isLoading) return <CircularProgress />;
  if (!endpoint) return <Typography>Endpoint not found</Typography>;

  const latest = heartbeats?.[0];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/domains')}>
          Back to Domains
        </Button>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => triggerCheck.mutate(id!)}
          disabled={triggerCheck.isPending}
        >
          {triggerCheck.isPending ? 'Checking...' : 'Run Check'}
        </Button>
      </Box>

      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <ScoreBadge score={computeScore({}).score} breakdown={computeScore({}).breakdown} size="medium" />
        <Typography variant="h4">{endpoint.host}</Typography>
        <Chip
          label={endpoint.status}
          color={endpoint.status === 'healthy' ? 'success' : endpoint.status === 'degraded' ? 'warning' : 'error'}
        />
      </Box>

      <Grid container spacing={3} mb={4}>
        {/* SSL/TLS Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                SSL / TLS
              </Typography>
              {latest ? (
                <>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    {latest.sslValid ? (
                      <CheckCircleIcon color="success" />
                    ) : (
                      <CancelIcon color="error" />
                    )}
                    <Typography>{latest.sslValid ? 'Valid' : 'Invalid'}</Typography>
                  </Box>
                  {latest.sslExpiry && (
                    <Typography variant="body2" color="text.secondary">
                      Expires: {new Date(latest.sslExpiry).toLocaleDateString()} ({latest.sslDaysLeft} days)
                    </Typography>
                  )}
                  {latest.sslIssuer && (
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      Issuer: {latest.sslIssuer}
                    </Typography>
                  )}
                  {latest.tlsVersion && (
                    <Typography variant="body2" color="text.secondary" mt={1}>
                      TLS: {latest.tlsVersion}
                    </Typography>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No check data yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Uptime Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                Uptime
              </Typography>
              {heartbeats && heartbeats.length > 0 ? (
                <>
                  <Typography variant="h3" color={latest?.isUp ? 'success.main' : 'error.main'}>
                    {latest?.isUp ? 'UP' : 'DOWN'}
                  </Typography>
                  {latest?.responseMs != null && (
                    <Typography variant="body2" color="text.secondary">
                      Response: {latest.responseMs}ms
                    </Typography>
                  )}
                  {latest?.statusCode && (
                    <Typography variant="body2" color="text.secondary">
                      HTTP {latest.statusCode}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary" mt={1}>
                    {heartbeats.filter((h) => h.isUp).length}/{heartbeats.length} checks passed
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No check data yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* DNS Security Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                DNS Security
              </Typography>
              {latest ? (
                <Box display="flex" flexDirection="column" gap={1}>
                  <DnsStatus label="SPF" value={latest.dnsSpf} />
                  <DnsStatus label="DKIM" value={latest.dnsDkim} />
                  <DnsStatus label="DMARC" value={latest.dnsDmarc} />
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No check data yet
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Check History */}
      <Typography variant="h5" mb={2}>
        Check History
      </Typography>
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Response</TableCell>
              <TableCell>SSL</TableCell>
              <TableCell>SPF</TableCell>
              <TableCell>DKIM</TableCell>
              <TableCell>DMARC</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {heartbeats?.map((hb) => (
              <TableRow key={hb.id}>
                <TableCell>{new Date(hb.createdAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Chip label={hb.isUp ? 'UP' : 'DOWN'} size="small" color={hb.isUp ? 'success' : 'error'} />
                </TableCell>
                <TableCell>{hb.responseMs ? `${hb.responseMs}ms` : '-'}</TableCell>
                <TableCell>
                  {hb.sslValid != null ? (
                    <Chip label={hb.sslValid ? 'Valid' : 'Invalid'} size="small" color={hb.sslValid ? 'success' : 'error'} />
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{hb.dnsSpf ?? '-'}</TableCell>
                <TableCell>{hb.dnsDkim ?? '-'}</TableCell>
                <TableCell>{hb.dnsDmarc ?? '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
