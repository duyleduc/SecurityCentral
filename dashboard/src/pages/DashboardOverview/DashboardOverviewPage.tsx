import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import { useDashboardSummary, useDashboardTopRisks, useDashboardAssets } from '../../api/hooks';
import { ScoreBadge } from '../../components/ScoreBadge';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};

function assetLabel(asset: { type: string; [key: string]: unknown }): string {
  if (asset.type === 'repository') {
    const owner = asset.owner as string | undefined;
    const name = asset.name as string | undefined;
    if (owner && name) return `${owner}/${name}`;
    return (name as string) ?? 'Repository';
  }
  if (asset.type === 'server') {
    return (asset.hostname as string) ?? 'Server';
  }
  if (asset.type === 'endpoint') {
    return (asset.host as string) ?? 'Domain';
  }
  return 'Asset';
}

export function DashboardOverviewPage() {
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: topRisks, isLoading: risksLoading } = useDashboardTopRisks();
  const { data: assets } = useDashboardAssets();

  if (summaryLoading) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const findings = summary?.findings;
  const score = summary?.score;
  const assetCounts = summary?.assets;

  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Dashboard
      </Typography>

      {/* Row 1: Overall score + severity summary */}
      <Grid container spacing={3} mb={3}>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 3 }}>
              <ScoreBadge
                score={score?.score ?? 100}
                breakdown={score?.breakdown}
                size="large"
              />
              <Typography variant="body2" color="text.secondary" mt={1}>
                Security Score
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
          <Grid key={sev} size={{ xs: 6, sm: 2.25 }}>
            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ color: SEVERITY_COLORS[sev], fontWeight: 700 }}>
                  {findings?.[sev] ?? 0}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                  {sev}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Row 2: Asset counts */}
      <Grid container spacing={3} mb={3}>
        {[
          { label: 'Projects', value: assetCounts?.projects ?? 0, icon: <FolderIcon sx={{ fontSize: 36 }} /> },
          { label: 'Repositories', value: assetCounts?.repositories ?? 0, icon: <CodeIcon sx={{ fontSize: 36 }} /> },
          { label: 'Servers', value: assetCounts?.servers ?? 0, icon: <StorageIcon sx={{ fontSize: 36 }} /> },
          { label: 'Domains', value: assetCounts?.domains ?? 0, icon: <DnsIcon sx={{ fontSize: 36 }} /> },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
            <Card>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ color: 'primary.main' }}>{s.icon}</Box>
                <Box>
                  <Typography variant="h4">{s.value}</Typography>
                  <Typography variant="body2" color="text.secondary">{s.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Row 3: Top Risks */}
      <Typography variant="h5" mb={2}>
        Top Risks
      </Typography>
      <Card sx={{ mb: 4 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Severity</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Asset</TableCell>
                <TableCell>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {risksLoading ? (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={20} />
                  </TableCell>
                </TableRow>
              ) : !topRisks?.length ? (
                <TableRow>
                  <TableCell colSpan={4} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    No critical or high findings.
                  </TableCell>
                </TableRow>
              ) : (
                topRisks.map((f) => (
                  <TableRow key={f.id} hover>
                    <TableCell>
                      <Chip
                        label={f.severity}
                        size="small"
                        sx={{
                          bgcolor: SEVERITY_COLORS[f.severity] ?? '#6b7280',
                          color: '#fff',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 350 }}>
                        {f.title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {f.repository
                          ? `${f.repository.owner}/${f.repository.name}`
                          : f.server
                            ? f.server.hostname
                            : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                        {new Date(f.createdAt).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Row 4: Asset scores */}
      {assets && assets.length > 0 && (
        <>
          <Typography variant="h5" mb={2}>
            Asset Scores
          </Typography>
          <Grid container spacing={3}>
            {assets.map((a) => (
              <Grid key={a.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ScoreBadge
                      score={a.score.score}
                      breakdown={a.score.breakdown}
                      size="medium"
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body1" fontWeight={600} noWrap>
                        {assetLabel(a)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                        {a.type}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
}
