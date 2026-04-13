import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Stack,
  CircularProgress, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import {
  useServer, useServerMetrics, useSecurityPosture,
  useServerVulnerabilities, usePackageInventory,
} from '../../api/hooks';
import type { CveFinding, SecurityPosture } from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';

// ---------------------------------------------------------------------------

function severityColor(s: string): 'error' | 'warning' | 'info' | 'default' {
  switch (s) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'default';
  }
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
    : <CancelIcon sx={{ fontSize: 16, color: 'error.main' }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="h6" sx={{ mt: 3, mb: 1.5, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      {children}
    </Typography>
  );
}

// ---------------------------------------------------------------------------

export function ServerReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: server, isLoading } = useServer(id ?? '');
  const { data: posture } = useSecurityPosture(id ?? '');
  const { data: vulns } = useServerVulnerabilities(id ?? '');
  const { data: inventory } = usePackageInventory(id ?? '');
  const { data: metrics } = useServerMetrics(id ?? '', 24);

  const score = useMemo(() => {
    const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const v of vulns ?? []) {
      if (sevCounts[v.severity] !== undefined) sevCounts[v.severity]++;
    }
    const audits = (posture as any)?.auditResults ?? [];
    for (const a of audits) {
      if (a.status === 'fail' && sevCounts[a.severity] !== undefined) sevCounts[a.severity]++;
    }
    if (posture && !posture.firewallActive) sevCounts.high++;
    return computeScore(sevCounts);
  }, [vulns, posture]);

  if (isLoading) return <CircularProgress />;
  if (!server) return <Typography>Server not found</Typography>;

  const latest = metrics?.[metrics.length - 1];
  const auditResults: Array<{ id: string; category: string; title: string; status: string; severity: string; detail: string }> =
    (posture as any)?.auditResults ?? [];
  const auditCategories = [...new Set(auditResults.map((r) => r.category))];
  const passCount = auditResults.filter((r) => r.status === 'pass').length;
  const failCount = auditResults.filter((r) => r.status === 'fail').length;

  const vulnsBySev = {
    critical: (vulns ?? []).filter((v) => v.severity === 'critical'),
    high: (vulns ?? []).filter((v) => v.severity === 'high'),
    medium: (vulns ?? []).filter((v) => v.severity === 'medium'),
    low: (vulns ?? []).filter((v) => v.severity === 'low'),
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(`/servers/${id}`)}>
          Back to Server
        </Button>
        <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
          Print
        </Button>
      </Stack>

      {/* ================================================================ */}
      {/* Report Header */}
      {/* ================================================================ */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={3} alignItems="center">
            <ScoreBadge score={score.score} breakdown={score.breakdown} size="large" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h4">{server.hostname}</Typography>
              <Typography variant="body2" color="text.secondary">
                {server.osFamily} {server.osVersion} &middot; {server.kernel ?? ''} &middot; {server.ipAddresses?.join(', ')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {server.cpuCores} cores &middot; {server.totalRamMb != null ? (server.totalRamMb >= 1024 ? `${(server.totalRamMb / 1024).toFixed(1)} GB RAM` : `${server.totalRamMb} MB RAM`) : ''} &middot; {server.totalDiskGb ?? '?'} GB disk
              </Typography>
              <Typography variant="caption" color="text.disabled">
                Report generated {new Date().toLocaleString()} &middot; Agent {server.agentVersion} &middot; ID {server.agentId}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Chip label={server.status} color={server.status === 'online' ? 'success' : 'error'} />
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* ================================================================ */}
      {/* Score Breakdown */}
      {/* ================================================================ */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Score Breakdown</Typography>
          <Grid container spacing={2}>
            {score.breakdown.filter((b) => b.count > 0).map((b) => (
              <Grid key={b.severity} size={{ xs: 6, sm: 3 }}>
                <Stack alignItems="center">
                  <Typography variant="h5" color={b.severity === 'critical' ? 'error.main' : b.severity === 'high' ? 'warning.main' : 'text.secondary'}>
                    {b.count}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{b.severity}</Typography>
                  <Typography variant="caption" color="error.main">-{b.deduction} pts</Typography>
                </Stack>
              </Grid>
            ))}
            {score.breakdown.every((b) => b.count === 0) && (
              <Grid size={{ xs: 12 }}>
                <Typography variant="body2" color="success.main" textAlign="center">No issues found — perfect score</Typography>
              </Grid>
            )}
          </Grid>
        </CardContent>
      </Card>

      {/* ================================================================ */}
      {/* Current Metrics Snapshot */}
      {/* ================================================================ */}
      {latest && (
        <>
          <SectionTitle>Current Metrics</SectionTitle>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {[
              { label: 'CPU', value: `${Math.round(latest.cpu)}%`, warn: latest.cpu > 85 },
              { label: 'RAM', value: `${Math.round(latest.memory)}%`, warn: latest.memory > 85 },
              { label: 'Disk', value: `${Math.round(latest.disk)}%`, warn: latest.disk > 90 },
              { label: 'Load', value: latest.loadAvg1?.toFixed(2) ?? '-', warn: (latest.loadAvg1 ?? 0) > (server.cpuCores ?? 4) },
              { label: 'Swap', value: `${Math.round(latest.swapUsedPct ?? 0)}%`, warn: (latest.swapUsedPct ?? 0) > 30 },
            ].map(({ label, value, warn }) => (
              <Grid key={label} size={{ xs: 4, sm: 2.4 }}>
                <Card sx={{ textAlign: 'center', py: 1.5, bgcolor: warn ? 'rgba(239,68,68,0.08)' : undefined }}>
                  <Typography variant="h5" sx={{ fontFamily: 'monospace', color: warn ? 'error.main' : 'text.primary' }}>{value}</Typography>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {/* ================================================================ */}
      {/* Security Posture */}
      {/* ================================================================ */}
      {posture && (
        <>
          <SectionTitle>Security Posture</SectionTitle>

          <Grid container spacing={2} sx={{ mb: 2 }}>
            {/* Firewall */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Card>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <StatusIcon ok={posture.firewallActive} />
                    <Typography variant="body2">
                      Firewall: <strong>{posture.firewallActive ? `${posture.firewallType} active` : 'inactive'}</strong>
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
            {/* SSH */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Card>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusIcon ok={posture.sshConfig.rootLogin !== 'yes'} />
                      <Typography variant="body2">Root login: <strong>{posture.sshConfig.rootLogin}</strong></Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusIcon ok={posture.sshConfig.passwordAuth !== 'yes'} />
                      <Typography variant="body2">Password auth: <strong>{posture.sshConfig.passwordAuth}</strong></Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <StatusIcon ok={posture.sshConfig.permitEmptyPwd !== 'yes'} />
                      <Typography variant="body2">Empty passwords: <strong>{posture.sshConfig.permitEmptyPwd}</strong></Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">SSH port: {posture.sshConfig.port}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Listening Ports */}
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            Listening Ports ({posture.listeningPorts.length})
          </Typography>
          <Card sx={{ mb: 2 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Port</TableCell>
                    <TableCell>Proto</TableCell>
                    <TableCell>Process</TableCell>
                    <TableCell>Bind</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {posture.listeningPorts.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{p.port}</TableCell>
                      <TableCell>{p.proto}</TableCell>
                      <TableCell>{p.process || '-'}</TableCell>
                      <TableCell>
                        <Chip label={p.bind || '0.0.0.0'} size="small"
                          color={p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '' ? 'warning' : 'default'}
                          variant="outlined" sx={{ fontSize: '0.7rem' }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          {/* Shell Users + Sessions */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Shell Users</Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {posture.shellUsers.map((u) => (
                  <Chip key={u} label={u} size="small" variant="outlined"
                    color={u === 'root' ? 'warning' : 'default'} sx={{ fontFamily: 'monospace' }} />
                ))}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Active Sessions</Typography>
              {posture.loggedInUsers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">None</Typography>
              ) : (
                <Stack spacing={0.25}>
                  {posture.loggedInUsers.map((u, i) => (
                    <Typography key={i} variant="body2"><strong>{u.user}</strong> from {u.from}</Typography>
                  ))}
                </Stack>
              )}
            </Grid>
          </Grid>

          {posture.pendingReboot && (
            <Chip icon={<WarningIcon />} label="System reboot pending" color="warning" variant="outlined" sx={{ mb: 2 }} />
          )}
          {posture.sshFailures > 0 && (
            <Chip label={`${posture.sshFailures} SSH authentication failures`}
              color={posture.sshFailures > 10 ? 'error' : 'warning'} variant="outlined" sx={{ mb: 2, ml: 1 }} />
          )}
        </>
      )}

      {/* ================================================================ */}
      {/* Hardening Audit */}
      {/* ================================================================ */}
      {auditResults.length > 0 && (
        <>
          <SectionTitle>
            Hardening Audit — {passCount} passed, {failCount} failed
          </SectionTitle>

          {auditCategories.map((cat) => {
            const items = auditResults.filter((r) => r.category === cat);
            return (
              <Box key={cat} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>{cat}</Typography>
                {items.map((item) => (
                  <Stack key={item.id} direction="row" spacing={1} alignItems="center"
                    sx={{ py: 0.4, pl: 1, borderLeft: '2px solid',
                      borderColor: item.status === 'pass' ? 'success.main' : item.status === 'fail' ? 'error.main' : 'warning.main',
                      mb: 0.25 }}>
                    {item.status === 'pass' ? <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} /> :
                     item.status === 'fail' ? <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} /> :
                     <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
                    <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>{item.title}</Typography>
                    {item.status !== 'pass' && (
                      <Chip label={item.severity} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }}
                        color={severityColor(item.severity)} />
                    )}
                  </Stack>
                ))}
              </Box>
            );
          })}
        </>
      )}

      {/* ================================================================ */}
      {/* Vulnerabilities */}
      {/* ================================================================ */}
      <SectionTitle>
        Vulnerabilities ({(vulns ?? []).length})
      </SectionTitle>

      {(vulns ?? []).length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No vulnerabilities found. {inventory ? `${inventory.packages.length} packages scanned.` : 'Waiting for package inventory.'}
        </Typography>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
            {vulnsBySev.critical.length > 0 && <Chip label={`${vulnsBySev.critical.length} critical`} size="small" color="error" variant="outlined" />}
            {vulnsBySev.high.length > 0 && <Chip label={`${vulnsBySev.high.length} high`} size="small" color="warning" variant="outlined" />}
            {vulnsBySev.medium.length > 0 && <Chip label={`${vulnsBySev.medium.length} medium`} size="small" color="info" variant="outlined" />}
            {vulnsBySev.low.length > 0 && <Chip label={`${vulnsBySev.low.length} low`} size="small" variant="outlined" />}
          </Stack>
          <Card sx={{ mb: 3 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>CVE</TableCell>
                    <TableCell>Package</TableCell>
                    <TableCell>Installed</TableCell>
                    <TableCell>Fixed</TableCell>
                    <TableCell>Severity</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(vulns ?? []).map((v) => (
                    <TableRow key={v.id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {v.cveId ? (
                          <a href={v.cveId.startsWith('CVE-')
                            ? `https://nvd.nist.gov/vuln/detail/${v.cveId}`
                            : `https://osv.dev/vulnerability/${v.cveId}`}
                            target="_blank" rel="noopener noreferrer"
                            style={{ color: '#6366f1', textDecoration: 'none' }}>
                            {v.cveId}
                          </a>
                        ) : '-'}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{v.detail?.packageName ?? '-'}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{v.detail?.installedVersion ?? '-'}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>
                        {v.detail?.fixedVersion
                          ? <Chip label={v.detail.fixedVersion} size="small" color="success" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                          : <Typography variant="caption" color="text.secondary">no fix</Typography>}
                      </TableCell>
                      <TableCell>
                        <Chip label={v.severity} size="small" color={severityColor(v.severity)} variant="outlined" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </>
      )}

      {/* ================================================================ */}
      {/* Package Inventory Summary */}
      {/* ================================================================ */}
      {inventory && (
        <>
          <SectionTitle>Package Inventory</SectionTitle>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {inventory.packages.length} packages &middot; scanned {new Date(inventory.collectedAt).toLocaleString()} &middot; hash {(inventory as any).packageHash?.slice(0, 12)}
          </Typography>
        </>
      )}
    </Box>
  );
}
