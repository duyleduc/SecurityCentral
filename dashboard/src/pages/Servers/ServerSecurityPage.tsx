import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Stack,
  CircularProgress,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Alert,
  Button,
  Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import {
  useServer,
  useSecurityPosture,
  useServerVulnerabilities,
  usePackageInventory,
  useTriggerCveScan,
  useAttackSurfaceScan,
  useTriggerAttackSurfaceScan,
  type CveFinding,
  type SecurityPosture,
} from '../../api/hooks';
import { ServerHeader } from './ServerHeader';

function severityColor(s: string): 'error' | 'warning' | 'info' | 'default' {
  switch (s) {
    case 'critical': return 'error';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'default';
  }
}

export function ServerSecurityPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState(0);
  const { data: server, isLoading } = useServer(id ?? '');
  const { data: posture } = useSecurityPosture(id ?? '');
  const { data: vulns } = useServerVulnerabilities(id ?? '');

  if (isLoading) return <CircularProgress />;
  if (!server) return <Typography>Server not found</Typography>;

  return (
    <Box>
      <ServerHeader server={server} activeTab="security" />

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Posture" />
          <Tab label={`Vulnerabilities${vulns?.length ? ` (${vulns.length})` : ''}`} />
          <Tab label="Attack Surface" />
        </Tabs>
      </Box>

      {tab === 0 && <SecurityPostureSection posture={posture ?? null} />}
      {tab === 1 && <VulnerabilitiesSection serverId={server.id} vulns={vulns ?? []} />}
      {tab === 2 && <AttackSurfaceSection serverId={server.id} />}
    </Box>
  );
}

function SecurityPostureSection({ posture }: { posture: SecurityPosture | null }) {
  const [showPorts, setShowPorts] = useState(false);

  if (!posture) {
    return (
      <Typography variant="body2" color="text.secondary">
        No security posture data yet. The agent scans every hour.
      </Typography>
    );
  }

  const sshOk = posture.sshConfig.rootLogin !== 'yes' && posture.sshConfig.passwordAuth !== 'yes';
  const fwOk = posture.firewallActive;
  const auditResults = posture.auditResults ?? [];
  const auditFail = auditResults.filter((r) => r.status === 'fail');
  const auditWarn = auditResults.filter((r) => r.status === 'warn');
  const auditPass = auditResults.filter((r) => r.status === 'pass');
  const internetPorts = posture.listeningPorts.filter((p) => p.exposure === 'internet');
  const restrictedPorts = posture.listeningPorts.filter((p) => p.exposure === 'restricted');
  const publicPorts = posture.listeningPorts.some((p) => p.exposure)
    ? internetPorts
    : posture.listeningPorts.filter((p) => p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '');

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {(() => {
          const fwIssues = posture.firewallDetail?.issues ?? [];
          const hasIssues = fwIssues.length > 0;
          const color = !fwOk ? 'error' : hasIssues ? 'warning' : 'success';
          const label = !fwOk
            ? 'No firewall'
            : hasIssues
              ? `Firewall (${posture.firewallType}) — misconfigured`
              : `Firewall (${posture.firewallType})`;
          const icon = !fwOk
            ? <CancelIcon />
            : hasIssues
              ? <WarningIcon />
              : <CheckCircleIcon />;
          const tooltipContent = !fwOk
            ? 'CRITICAL: No firewall detected. Server is directly exposed to the internet. Enable ufw, nftables, or iptables immediately.'
            : hasIssues
              ? `${posture.firewallType} is active but has ${fwIssues.length} configuration issue${fwIssues.length > 1 ? 's' : ''}:\n\n${fwIssues.map((i) => '• ' + i).join('\n')}`
              : `${posture.firewallType} firewall is active and blocking unauthorized traffic.${posture.firewallDetail?.defaultPolicy ? `\n\nDefault input policy: ${posture.firewallDetail.defaultPolicy}` : ''}`;
          return (
            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>} arrow>
              <Chip size="small" icon={icon} label={label} color={color} variant="outlined" />
            </Tooltip>
          );
        })()}
        <Tooltip title={sshOk
          ? 'SSH is hardened: root login disabled and password authentication disabled (key-based auth only).'
          : 'CRITICAL: SSH allows root login or password authentication. Attackers can brute force. Edit /etc/ssh/sshd_config: set PermitRootLogin no and PasswordAuthentication no.'} arrow>
          <Chip size="small" icon={sshOk ? <CheckCircleIcon /> : <CancelIcon />}
            label={sshOk ? 'SSH hardened' : 'SSH weak'}
            color={sshOk ? 'success' : 'error'} variant="outlined" />
        </Tooltip>
        {posture.pendingReboot && (
          <Tooltip title="Kernel or system packages were updated but the new versions are not yet active. Reboot when convenient to apply patches. Not urgent, but don't leave indefinitely." arrow>
            <Chip size="small" icon={<WarningIcon />} label="Reboot pending" color="warning" variant="outlined" />
          </Tooltip>
        )}
        {posture.sshFailures > 0 && (
          <Tooltip title={posture.sshFailures > 10
            ? `CRITICAL: ${posture.sshFailures} failed SSH login attempts detected. This indicates an active brute-force attack. Consider blocking attacker IPs via fail2ban or firewall.`
            : `${posture.sshFailures} failed SSH login attempts detected. Monitor and block the source IPs if the count grows.`} arrow>
            <Chip size="small" label={`${posture.sshFailures} SSH fail attempts`}
              color={posture.sshFailures > 10 ? 'error' : 'warning'} variant="outlined" />
          </Tooltip>
        )}
        <Tooltip title={
          restrictedPorts.length > 0
            ? `${publicPorts.length} port${publicPorts.length === 1 ? '' : 's'} reachable from the internet. ${restrictedPorts.length} more allow only specific source IPs (safe).`
            : `${publicPorts.length} port${publicPorts.length === 1 ? '' : 's'} reachable from the internet.`
        } arrow>
          <Chip size="small" label={`${publicPorts.length} exposed ports${restrictedPorts.length > 0 ? ` (+${restrictedPorts.length} restricted)` : ''}`}
            color={publicPorts.length > 5 ? 'warning' : 'default'} variant="outlined"
            onClick={() => setShowPorts(!showPorts)} sx={{ cursor: 'pointer' }} />
        </Tooltip>
        <Chip size="small" label={`${posture.shellUsers.length} shell users (${posture.shellUsers.join(', ')})`} variant="outlined" />
        {posture.loggedInUsers.length > 0 && (
          <Chip size="small" label={`${posture.loggedInUsers.length} active session${posture.loggedInUsers.length > 1 ? 's' : ''}`} variant="outlined" />
        )}
        {auditResults.length > 0 && (
          <Chip size="small"
            label={`Audit: ${auditPass.length} pass / ${auditFail.length} fail`}
            color={auditFail.length === 0 ? 'success' : auditFail.length <= 3 ? 'warning' : 'error'}
            variant="outlined" />
        )}
        {posture.cisSummary && posture.cisSummary.mapped > 0 && (
          <Chip size="small"
            label={`CIS: ${posture.cisSummary.passing}/${posture.cisSummary.mapped} controls`}
            color={posture.cisSummary.failing === 0 ? 'success' : 'warning'}
            variant="outlined" />
        )}
      </Stack>

      {showPorts && (
        <Card sx={{ bgcolor: 'rgba(15,23,42,0.5)' }}>
          <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              <strong>Red</strong> = exposed to the internet (bound publicly, firewall allows anywhere).
              <strong> Green</strong> = restricted (firewall allows only specific IPs).
              <strong> Blue</strong> = blocked (firewall drops traffic despite public bind).
              <strong> Grey</strong> = localhost only.
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {posture.listeningPorts.map((p, i) => {
                const bindLabel = p.bind || '0.0.0.0';
                const exposure = p.exposure ?? (p.bind === '0.0.0.0' || p.bind === '::' || p.bind === '' ? 'internet' : 'localhost');
                let color: 'error' | 'success' | 'info' | 'default' = 'default';
                let tooltip = '';
                switch (exposure) {
                  case 'internet':
                    color = 'error';
                    tooltip = `EXPOSED: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is reachable from the internet. No firewall restriction.`;
                    break;
                  case 'restricted':
                    color = 'success';
                    tooltip = `RESTRICTED: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is bound publicly but firewall allows only: ${(p.allowedFrom ?? []).join(', ')}`;
                    break;
                  case 'blocked':
                    color = 'info';
                    tooltip = `BLOCKED: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is bound publicly but firewall default policy blocks all inbound traffic to it.`;
                    break;
                  case 'localhost':
                    color = 'default';
                    tooltip = `LOCAL: ${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto} is only accessible from the same machine.`;
                    break;
                  default:
                    tooltip = `${p.process || 'unknown'} on ${bindLabel}:${p.port}/${p.proto}. Exposure unknown (agent may be old or firewall unreadable).`;
                }
                return (
                  <Tooltip key={i} title={tooltip} arrow>
                    <Chip size="small" variant="outlined"
                      label={`${bindLabel}:${p.port}/${p.proto} ${p.process || ''}`}
                      color={color}
                      sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }} />
                  </Tooltip>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      )}

      {auditFail.length + auditWarn.length > 0 && (
        <Card>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>Issues Found</Typography>
            {[...auditFail, ...auditWarn].map((item) => (
              <Stack key={item.id} direction="row" spacing={1} alignItems="center"
                sx={{ py: 0.5, borderLeft: '2px solid', borderColor: item.status === 'fail' ? 'error.main' : 'warning.main', pl: 1, mb: 0.5 }}>
                {item.status === 'fail'
                  ? <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  : <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
                <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>{item.title}</Typography>
                {item.cis && (
                  <Chip label={`${item.cis.benchmark} ${item.cis.controlId}`} size="small" variant="outlined"
                    sx={{ fontSize: '0.55rem', height: 18, borderColor: 'info.main', color: 'info.main' }} />
                )}
                <Chip label={item.severity} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }}
                  color={item.severity === 'critical' ? 'error' : item.severity === 'high' ? 'warning' : 'default'} />
              </Stack>
            ))}
          </CardContent>
        </Card>
      )}

      {!sshOk && (
        <Card sx={{ bgcolor: 'rgba(15,23,42,0.5)' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, color: 'text.secondary' }}>SSH Configuration</Typography>
            <Stack spacing={0.5}>
              {posture.sshConfig.rootLogin === 'yes' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  <Typography variant="body2" fontSize="0.8rem">Root login enabled</Typography>
                </Stack>
              )}
              {posture.sshConfig.passwordAuth === 'yes' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  <Typography variant="body2" fontSize="0.8rem">Password auth enabled (use key-based)</Typography>
                </Stack>
              )}
              {posture.sshConfig.permitEmptyPwd === 'yes' && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  <Typography variant="body2" fontSize="0.8rem">Empty passwords permitted</Typography>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {posture.bruteForce && (posture.bruteForce.sshVelocity > 0 || posture.bruteForce.httpVelocity > 0) && (() => {
        const bf = posture.bruteForce!;
        return (
          <Card sx={{ bgcolor: bf.isActiveAttack || bf.hasCompromise ? 'rgba(239,68,68,0.08)' : 'rgba(15,23,42,0.5)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <Typography variant="subtitle2" sx={{ color: bf.isActiveAttack ? 'error.main' : 'text.secondary' }}>
                  {bf.isActiveAttack ? 'Active Attack Detected' : 'Brute Force Activity'}
                </Typography>
                {bf.isActiveAttack && <Chip label="ACTIVE" size="small" color="error" variant="filled" sx={{ fontSize: '0.6rem', height: 18 }} />}
                {bf.isDistributed && <Chip label="DISTRIBUTED" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />}
              </Stack>

              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                {bf.sshVelocity > 0 && (
                  <Typography variant="body2" fontSize="0.8rem">
                    SSH: <strong>{bf.sshVelocity}</strong> failures/5min from <strong>{bf.sshUniqueIps}</strong> IPs
                  </Typography>
                )}
                {bf.httpVelocity > 0 && (
                  <Typography variant="body2" fontSize="0.8rem">
                    HTTP: <strong>{bf.httpVelocity}</strong> 401/403s/5min from <strong>{bf.httpUniqueIps}</strong> IPs
                  </Typography>
                )}
              </Stack>

              {bf.sshTopAttackers && bf.sshTopAttackers.length > 0 && (
                <Stack direction="row" spacing={0.5} mt={0.75} flexWrap="wrap" useFlexGap>
                  {bf.sshTopAttackers.map((a) => (
                    <Chip key={a.ip} label={`${a.ip} (${a.count}x)`} size="small" variant="outlined"
                      sx={{ fontFamily: 'monospace', fontSize: '0.65rem' }} />
                  ))}
                </Stack>
              )}

              {bf.hasCompromise && bf.sshCompromise?.map((c, i) => (
                <Alert key={i} severity="error" sx={{ mt: 1, py: 0.5 }}>
                  <strong>Potential compromise:</strong> {c.ip} failed {c.failuresBefore}x then logged in as "{c.successUser}"
                </Alert>
              ))}
            </CardContent>
          </Card>
        );
      })()}

      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
        Last scan: {new Date(posture.collectedAt).toLocaleString()}
      </Typography>
    </Stack>
  );
}

function VulnerabilitiesSection({ serverId, vulns }: { serverId: string; vulns: CveFinding[] }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const { data: inventory } = usePackageInventory(serverId);
  const scanMutation = useTriggerCveScan();
  const hasInventory = !!inventory;

  const filtered = filter === 'all'
    ? vulns
    : filter === 'fix'
      ? vulns.filter((v) => v.detail?.fixedVersion)
      : filter === 'kev'
        ? vulns.filter((v) => v.detail?.cisaKev)
        : vulns.filter((v) => v.severity === filter);

  const critCount = vulns.filter((v) => v.severity === 'critical').length;
  const highCount = vulns.filter((v) => v.severity === 'high').length;
  const medCount = vulns.filter((v) => v.severity === 'medium').length;
  const lowCount = vulns.filter((v) => v.severity === 'low').length;
  const fixAvail = vulns.filter((v) => v.detail?.fixedVersion).length;
  const kevCount = vulns.filter((v) => v.detail?.cisaKev).length;

  const handleFilterChange = (f: string) => {
    setFilter(f);
    setPage(0);
  };

  const scanButton = (
    <Button
      size="small"
      variant="outlined"
      disabled={scanMutation.isPending || !hasInventory}
      onClick={() => scanMutation.mutate(serverId)}
      title={hasInventory ? 'Run CVE scan against latest vulnerability feeds' : 'Waiting for agent to send package inventory'}
    >
      {scanMutation.isPending ? 'Scanning...' : 'Run CVE Scan'}
    </Button>
  );

  if (!hasInventory) {
    return (
      <Typography variant="body2" color="text.secondary">
        Waiting for agent to send package inventory (daily scan).
      </Typography>
    );
  }

  if (vulns.length === 0) {
    return (
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          No vulnerabilities found — {inventory.packages.length} packages scanned {new Date(inventory.collectedAt).toLocaleDateString()}
        </Typography>
        {scanButton}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip label={`${vulns.length} total`} variant={filter === 'all' ? 'filled' : 'outlined'}
            color={filter === 'all' ? 'primary' : 'default'} onClick={() => handleFilterChange('all')} />
          {critCount > 0 && (
            <Chip label={`${critCount} critical`} color={filter === 'critical' ? 'error' : 'default'}
              variant={filter === 'critical' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('critical')} />
          )}
          {highCount > 0 && (
            <Chip label={`${highCount} high`} color={filter === 'high' ? 'warning' : 'default'}
              variant={filter === 'high' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('high')} />
          )}
          {medCount > 0 && (
            <Chip label={`${medCount} medium`} color={filter === 'medium' ? 'info' : 'default'}
              variant={filter === 'medium' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('medium')} />
          )}
          {lowCount > 0 && (
            <Chip label={`${lowCount} low`} color={filter === 'low' ? 'success' : 'default'}
              variant={filter === 'low' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('low')} />
          )}
          {fixAvail > 0 && (
            <Chip label={`${fixAvail} fix available`} color={filter === 'fix' ? 'primary' : 'default'}
              variant={filter === 'fix' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('fix')} />
          )}
          {kevCount > 0 && (
            <Chip label={`${kevCount} CISA KEV`} color="error"
              variant={filter === 'kev' ? 'filled' : 'outlined'} onClick={() => handleFilterChange('kev')} />
          )}
        </Stack>
        {scanButton}
      </Stack>

      {scanMutation.isSuccess && (
        <Alert severity="success">
          Scan complete: {scanMutation.data.matched} CVEs matched across {scanMutation.data.packages} packages.
          {scanMutation.data.created > 0 ? ` ${scanMutation.data.created} new findings.` : ''}
          {scanMutation.data.resolved > 0 ? ` ${scanMutation.data.resolved} resolved.` : ''}
        </Alert>
      )}
      {scanMutation.isError && (
        <Alert severity="error">{(scanMutation.error as Error).message}</Alert>
      )}

      <Card>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>CVE</TableCell>
                  <TableCell>Package</TableCell>
                  <TableCell>Fixed</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>EPSS</TableCell>
                  <TableCell>Fix</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((v) => {
                  const epss = v.detail?.epss;
                  const epssColor = epss != null ? (epss >= 0.5 ? 'error.main' : epss >= 0.1 ? 'warning.main' : 'text.secondary') : undefined;
                  return (
                    <TableRow key={v.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        <Stack spacing={0.25}>
                          {v.cveId ? (
                            <a href={v.cveId.startsWith('CVE-')
                              ? `https://nvd.nist.gov/vuln/detail/${v.cveId}`
                              : `https://osv.dev/vulnerability/${v.cveId}`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ color: '#6366f1', textDecoration: 'none' }}>
                              {v.cveId}
                            </a>
                          ) : '-'}
                          <Stack direction="row" spacing={0.5}>
                            {v.detail?.cisaKev && <Chip label="KEV" size="small" color="error" variant="filled" sx={{ fontSize: '0.55rem', height: 16 }} />}
                            {v.cvssScore != null && <Chip label={`CVSS ${v.cvssScore.toFixed(1)}`} size="small" variant="outlined" sx={{ fontSize: '0.55rem', height: 16 }} />}
                          </Stack>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>{v.detail?.packageName ?? '-'}</Typography>
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>{v.detail?.installedVersion ?? ''}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>
                        {v.detail?.fixedVersion ? (
                          <Chip label={v.detail.fixedVersion} size="small" color="success" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                        ) : (
                          <Typography variant="caption" color="text.disabled">-</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip label={v.severity} size="small" color={severityColor(v.severity)} variant="outlined" sx={{ fontSize: '0.7rem' }} />
                      </TableCell>
                      <TableCell>
                        {epss != null ? (
                          <Tooltip title={`${(epss * 100).toFixed(1)}% chance of exploitation in 30 days (${Math.round((v.detail?.epssPercentile ?? 0) * 100)}th percentile)`} arrow>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600, color: epssColor, cursor: 'help' }}>
                              {(epss * 100).toFixed(1)}%
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.disabled">-</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {v.detail?.remediation ? (
                          <Tooltip title={v.detail.remediation} arrow>
                            <Chip label="How to fix" size="small" variant="outlined" color="info"
                              sx={{ fontSize: '0.6rem', height: 20, cursor: 'help' }} />
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.disabled">-</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        No vulnerabilities match the selected filter.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {filtered.length > 0 && (
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

function AttackSurfaceSection({ serverId }: { serverId: string }) {
  const { data: scan } = useAttackSurfaceScan(serverId);
  const scanMutation = useTriggerAttackSurfaceScan();

  const isRunning = scan?.status === 'running';
  const openPorts = scan?.openPorts ?? [];
  const adminPanels = scan?.adminPanels ?? [];
  const summary = scan?.summary;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {scan?.completedAt
            ? `Last scan: ${new Date(scan.completedAt).toLocaleString()} — ${scan.targetIp}`
            : 'No scan yet'}
        </Typography>
        <Button
          size="small" variant="outlined"
          disabled={scanMutation.isPending || isRunning}
          onClick={() => scanMutation.mutate(serverId)}
        >
          {isRunning ? 'Scanning...' : 'Run Scan'}
        </Button>
      </Stack>

      {scanMutation.isError && (
        <Alert severity="error" sx={{ py: 0.5 }}>{(scanMutation.error as Error).message}</Alert>
      )}

      {summary && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`${summary.totalOpen} open ports`} variant="outlined" />
          {summary.critical > 0 && <Chip size="small" label={`${summary.critical} critical`} color="error" variant="outlined" />}
          {summary.high > 0 && <Chip size="small" label={`${summary.high} high`} color="warning" variant="outlined" />}
          {summary.adminPanels > 0 && <Chip size="small" label={`${summary.adminPanels} admin panels`} color="error" variant="outlined" />}
        </Stack>
      )}

      {openPorts.length > 0 && (
        <Card>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Port</TableCell>
                    <TableCell>Service</TableCell>
                    <TableCell>Version</TableCell>
                    <TableCell>Risk</TableCell>
                    <TableCell>Response</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {openPorts.map((p) => (
                    <TableRow key={p.port}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{p.port}</TableCell>
                      <TableCell>
                        {p.service}
                        {p.isDatabase && <Chip label="DB" size="small" color="error" variant="outlined" sx={{ ml: 0.5, fontSize: '0.6rem', height: 16 }} />}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{p.version ?? '-'}</TableCell>
                      <TableCell>
                        <Chip label={p.riskLevel} size="small" variant="outlined"
                          color={p.riskLevel === 'critical' ? 'error' : p.riskLevel === 'high' ? 'warning' : p.riskLevel === 'medium' ? 'info' : 'default'} />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{p.responseMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {adminPanels.length > 0 && (
        <Card>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'error.main' }}>Exposed Admin Panels</Typography>
            {adminPanels.map((p, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  :{p.port}{p.path}
                </Typography>
                <Chip label={`HTTP ${p.status}`} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 16 }} />
              </Stack>
            ))}
          </CardContent>
        </Card>
      )}

      {!scan && !scanMutation.isPending && (
        <Typography variant="body2" color="text.secondary">
          Run an attack surface scan to discover what's externally reachable on this server.
        </Typography>
      )}
    </Stack>
  );
}
