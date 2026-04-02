import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, LinearProgress,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Paper, Skeleton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudIcon from '@mui/icons-material/Cloud';
import { useCoverageStats, useUnmonitoredServers, useTriggerDiscovery, type CloudResource, type CoverageStats } from '../../api/hooks.js';
import AddServerDialog from '../../components/AddServerDialog.js';

const PROVIDER_LABEL: Record<string, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', proxmox: 'Proxmox' };

function coverageColor(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 90) return 'success';
  if (pct >= 70) return 'warning';
  return 'error';
}

function coverageHex(pct: number): string {
  if (pct >= 90) return '#16a34a';
  if (pct >= 70) return '#ca8a04';
  return '#dc2626';
}

export function InfrastructureCoveragePage() {
  const stats = useCoverageStats();
  const unmonitored = useUnmonitoredServers();
  const triggerDiscovery = useTriggerDiscovery();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const coverageData = stats.data?.data as CoverageStats | undefined;
  const unmonitoredData = (unmonitored.data?.data ?? []) as CloudResource[];

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
        <Typography variant="h5">Infrastructure Coverage</Typography>
        <Button component={Link} to="/integrations" startIcon={<AddIcon />} size="small">
          Connect Cloud Account
        </Button>
      </Stack>

      {/* Overall coverage bar */}
      {coverageData && (
        <Card sx={{ mb: 2.5 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>Overall Coverage</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: coverageHex(coverageData.overall_coverage_pct) }}>
                {coverageData.overall_coverage_pct}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={coverageData.overall_coverage_pct}
              color={coverageColor(coverageData.overall_coverage_pct)}
              sx={{ height: 8, borderRadius: 4 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {coverageData.total_monitored} of {coverageData.total_instances} instances have agents installed
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Provider/region breakdown */}
      {coverageData && coverageData.breakdown.length > 0 && (
        <Card sx={{ mb: 2.5 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="h6">By Provider & Region</Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={() => triggerDiscovery.mutate('aws')}
                disabled={triggerDiscovery.isPending}
              >
                {triggerDiscovery.isPending ? 'Refreshing...' : 'Refresh All'}
              </Button>
            </Stack>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Provider</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell align="right">Instances</TableCell>
                    <TableCell align="right">Agents</TableCell>
                    <TableCell align="right">Coverage</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {coverageData.breakdown.map((row) => (
                    <TableRow key={`${row.provider}:${row.region}`}>
                      <TableCell>{PROVIDER_LABEL[row.provider] ?? row.provider}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{row.region}</TableCell>
                      <TableCell align="right">{row.total}</TableCell>
                      <TableCell align="right">{row.monitored}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ color: coverageHex(row.coverage_pct), fontWeight: 600 }}>
                          {row.coverage_pct}%
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <LinearProgress
                          variant="determinate"
                          value={row.coverage_pct}
                          color={coverageColor(row.coverage_pct)}
                          sx={{ height: 6, borderRadius: 3, width: 80 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {stats.isLoading ? (
        <Box sx={{ p: 5 }}>
          <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2, mb: 2 }} />
          <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
        </Box>
      ) : coverageData && coverageData.total_instances === 0 && (
        <Card sx={{ mb: 2.5 }}>
          <CardContent sx={{ py: 5, textAlign: 'center' }}>
            <CloudIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>No cloud accounts connected</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Connect AWS, Azure, or GCP to discover your infrastructure
            </Typography>
            <Button component={Link} to="/integrations" variant="contained">
              Connect Cloud Account
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Unmonitored servers */}
      {unmonitoredData.length > 0 && (
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="h6">Unmonitored Servers</Typography>
              <Chip label={unmonitoredData.length} size="small" color="error" />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These instances are running but don't have the SecurityCentral agent installed.
            </Typography>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Instance</TableCell>
                    <TableCell>Hostname</TableCell>
                    <TableCell>Provider</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell>IP</TableCell>
                    <TableCell sx={{ width: 140 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {unmonitoredData.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{r.resourceId}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{r.hostname ?? '--'}</TableCell>
                      <TableCell>{r.provider.toUpperCase()}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{r.region ?? '--'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{r.ipAddress ?? '--'}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={() => setShowAddDialog(true)}
                        >
                          Install Agent
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
      <AddServerDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
    </Box>
  );
}
