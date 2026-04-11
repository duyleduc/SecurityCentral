import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, Paper,
  CircularProgress, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip, IconButton, LinearProgress, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SecurityIcon from '@mui/icons-material/Security';
import LockIcon from '@mui/icons-material/Lock';
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningIcon from '@mui/icons-material/Warning';
import { useEndpoint, useHeartbeats, useTriggerCheck, useTriggerSslScan, useLatestSslScan, useUpdateEndpoint } from '../../api/hooks';
import { useRealtimeHeartbeat } from '../../ws/useRealtimeHeartbeat';

const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  healthy: { color: '#16a34a', text: 'Up' },
  degraded: { color: '#d97706', text: 'Degraded' },
  down: { color: '#dc2626', text: 'Down' },
  pending: { color: '#9e9e9e', text: 'Pending' },
};

export function DomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: endpoint, isLoading } = useEndpoint(id ?? '');
  const { data: heartbeats } = useHeartbeats(id ?? '', 100);
  const { data: latestSslHb } = useLatestSslScan(id ?? '');
  const triggerCheck = useTriggerCheck();
  const sslScan = useTriggerSslScan();
  const updateEndpoint = useUpdateEndpoint();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sslReportOpen, setSslReportOpen] = useState(false);
  const [editInterval, setEditInterval] = useState(15);
  const [editTimeout, setEditTimeout] = useState(30);

  useRealtimeHeartbeat(id);

  const uptimeBeats = useMemo(() => (heartbeats ?? []).filter((h) => h.sslValid == null), [heartbeats]);

  if (isLoading) return <CircularProgress />;
  if (!endpoint) return <Typography>Endpoint not found</Typography>;

  const ep = endpoint as any;
  const statusInfo = STATUS_LABEL[ep.status] ?? STATUS_LABEL.pending;
  const sslDetails = latestSslHb?.details as any;
  const sslInfo = sslDetails?.ssl;
  const dnsInfo = sslDetails?.dns;
  const upCount = uptimeBeats.filter((h) => h.isUp).length;
  const latestBeat = uptimeBeats[0];
  const uptimePct = uptimeBeats.length > 0 ? ((upCount / uptimeBeats.length) * 100).toFixed(1) : null;
  const avgMs = uptimeBeats.length > 0
    ? Math.round(uptimeBeats.reduce((s, h) => s + (h.responseMs ?? 0), 0) / uptimeBeats.length) : null;

  const openSettings = () => {
    setEditInterval(ep.uptimeInterval ?? 15);
    setEditTimeout(ep.uptimeTimeout ?? 30);
    setSettingsOpen(true);
  };

  const handleSslScan = () => sslScan.mutate(id!);

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate('/domains')}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: statusInfo.color, flexShrink: 0 }} />
            <Typography variant="h5" fontWeight={600}>
              {ep.host}{ep.port !== 443 ? `:${ep.port}` : ''}
            </Typography>
            <Chip label={statusInfo.text} size="small" sx={{ bgcolor: statusInfo.color, color: '#fff', fontWeight: 600 }} />
          </Stack>
        </Box>
        <Button variant="outlined" size="small" startIcon={<SettingsIcon />} onClick={openSettings}>Settings</Button>
      </Stack>

      {/* SSL Scan Section */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <LockIcon sx={{ color: sslInfo ? (sslInfo.grade === 'F' || sslInfo.grade === 'C' ? '#dc2626' : '#16a34a') : '#9e9e9e' }} />
              <Typography variant="h6">SSL / TLS Security</Typography>
            </Stack>
            <Button
              variant="contained" size="small"
              startIcon={sslScan.isPending ? <CircularProgress size={16} color="inherit" /> : <SecurityIcon />}
              onClick={handleSslScan}
              disabled={sslScan.isPending}
            >
              {sslScan.isPending ? 'Scanning...' : 'Run SSL Scan'}
            </Button>
          </Stack>

          {/* Progress bar while scanning */}
          {sslScan.isPending && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Checking certificate, protocol, cipher suite, chain validity, HSTS, DNS records...
              </Typography>
            </Box>
          )}

          {/* SSL Score — clickable to open report */}
          {sslInfo ? (
            <Box
              onClick={() => setSslReportOpen(true)}
              sx={{ cursor: 'pointer', '&:hover': { opacity: 0.85 }, transition: 'opacity 0.15s' }}
            >
              <Stack direction="row" spacing={3} alignItems="center">
                <GradeBadge grade={sslInfo.grade} color={sslInfo.gradeColor} size={64} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight={600}>{sslInfo.gradeNote}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {sslInfo.tlsVersion} · {sslInfo.cipherName} · {sslInfo.keyAlgorithm} {sslInfo.keyBits ? `${sslInfo.keyBits}-bit` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Expires in {sslInfo.daysLeft}d · Issued by {sslInfo.issuerCn} · Click for full report
                  </Typography>
                </Box>
                <Stack alignItems="center">
                  <Typography variant="h4" fontWeight={700} sx={{ color: sslInfo.gradeColor }}>{sslInfo.daysLeft}</Typography>
                  <Typography variant="caption" color="text.secondary">days left</Typography>
                </Stack>
              </Stack>
            </Box>
          ) : !sslScan.isPending ? (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <Typography color="text.secondary">No SSL scan results yet. Click "Run SSL Scan" to check.</Typography>
            </Box>
          ) : null}
        </CardContent>
      </Card>

      {/* Summary cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 3 }}>
        <SummaryCard label="Uptime" value={uptimePct ? `${uptimePct}%` : '--'}
          color={uptimePct == null ? '#9e9e9e' : Number(uptimePct) >= 99 ? '#16a34a' : Number(uptimePct) >= 95 ? '#d97706' : '#dc2626'}
          sub={`${upCount}/${uptimeBeats.length} checks`} />
        <SummaryCard label="Avg Response" value={avgMs != null ? `${avgMs}ms` : '--'} sub="across all checks" />
        <SummaryCard label="Check Interval" value={`${ep.uptimeInterval ?? 15}s`} sub={`Timeout: ${ep.uptimeTimeout ?? 30}s`} />
        {latestBeat?.responseMs != null && (
          <SummaryCard label="Last Response" value={`${latestBeat.responseMs}ms`}
            color={latestBeat.responseMs < 300 ? '#16a34a' : latestBeat.responseMs < 1000 ? '#d97706' : '#dc2626'}
            sub={`HTTP ${latestBeat.statusCode ?? '?'}`} />
        )}
      </Box>

      {/* Heartbeat bar */}
      {uptimeBeats.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">Heartbeat</Typography>
            <Typography variant="caption" color="text.secondary">{uptimeBeats.length} checks</Typography>
          </Stack>
          <HeartbeatBar beats={uptimeBeats} />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {new Date(uptimeBeats[uptimeBeats.length - 1]?.createdAt).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(uptimeBeats[0]?.createdAt).toLocaleString()}
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Response time chart */}
      {uptimeBeats.length > 1 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Response Time</Typography>
          <ResponseTimeChart data={uptimeBeats} />
        </Paper>
      )}

      {uptimeBeats.length === 0 && !isLoading && (
        <Paper sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No uptime checks yet. Waiting for sc-monitor...</Typography>
        </Paper>
      )}

      {/* SSL Report Dialog */}
      {sslInfo && (
        <SslReportDialog open={sslReportOpen} onClose={() => setSslReportOpen(false)} ssl={sslInfo} dns={dnsInfo} />
      )}

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Uptime Check Settings</DialogTitle>
        <DialogContent>
          <TextField fullWidth type="number" label="Check interval (seconds)" value={editInterval}
            onChange={(e) => setEditInterval(Number(e.target.value))} margin="normal"
            inputProps={{ min: 5, max: 3600 }} helperText="How often to ping (5–3600s)" />
          <TextField fullWidth type="number" label="Timeout (seconds)" value={editTimeout}
            onChange={(e) => setEditTimeout(Number(e.target.value))} margin="normal"
            inputProps={{ min: 5, max: 120 }} helperText="Max wait before marking down (5–120s)" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={async () => { await updateEndpoint.mutateAsync({ id: id!, uptimeInterval: editInterval, uptimeTimeout: editTimeout }); setSettingsOpen(false); }}
            disabled={updateEndpoint.isPending}>
            {updateEndpoint.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Grade Badge
// ---------------------------------------------------------------------------

function GradeBadge({ grade, color, size = 48 }: { grade: string; color: string; size?: number }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: color, color: '#fff',
      fontWeight: 800, fontSize: size * 0.4,
      boxShadow: `0 0 0 4px ${color}22`,
      flexShrink: 0,
    }}>
      {grade}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SSL Report Dialog — full security checklist
// ---------------------------------------------------------------------------

function SslReportDialog({ open, onClose, ssl, dns }: { open: boolean; onClose: () => void; ssl: any; dns: any }) {
  const protocols: { name: string; supported: boolean }[] = ssl.protocols ?? [];
  const httpHeaders = ssl.httpHeaders ?? {};
  const handshake = ssl.handshake ?? {};
  const vulns: { id: string; name: string; cve: string; status: string; detail: string }[] = ssl.vulnerabilities ?? [];
  const chainDetails: { subject: string; organization: string; issuer: string; validFrom: string; validTo: string; expired: boolean; isSelfSigned: boolean }[] = ssl.chainDetails ?? [];

  const vulnSafe = vulns.filter((v) => v.status === 'safe').length;
  const vulnWarn = vulns.filter((v) => v.status === 'warning').length;
  const vulnBad = vulns.filter((v) => v.status === 'vulnerable').length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      {/* Header — SSL Labs style large grade */}
      <DialogTitle sx={{ pb: 0 }}>
        <Stack direction="row" spacing={3} alignItems="center">
          <GradeBadge grade={ssl.grade} color={ssl.gradeColor} size={72} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight={700}>SSL Report</Typography>
            <Typography variant="body2" sx={{ color: ssl.gradeColor, fontWeight: 600, mt: 0.5 }}>{ssl.gradeNote}</Typography>
            <Typography variant="caption" color="text.secondary">
              {ssl.subjectCn} · Scanned {ssl.scannedAt ? new Date(ssl.scannedAt).toLocaleString() : '-'}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ pt: 3 }}>
        {/* ── Section 1: Certificate Validity ── */}
        <SectionTitle icon="🔒" title="1. Certificate Validity" />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2, ml: 1 }}>
          <KvRow label="Subject" value={ssl.subjectCn} />
          <KvRow label="Issuer" value={ssl.issuerCn} />
          <KvRow label="Valid From" value={ssl.notBefore ? new Date(ssl.notBefore).toLocaleDateString() : '-'} />
          <KvRow label="Valid To" value={ssl.expiry ? new Date(ssl.expiry).toLocaleDateString() : '-'}
            valueColor={ssl.daysLeft <= 0 ? '#dc2626' : ssl.daysLeft <= 30 ? '#d97706' : undefined} />
          <KvRow label="Days Remaining" value={ssl.daysLeft <= 0 ? `Expired ${Math.abs(ssl.daysLeft)} days ago` : `${ssl.daysLeft} days`}
            valueColor={ssl.daysLeft <= 0 ? '#dc2626' : ssl.daysLeft <= 30 ? '#d97706' : '#16a34a'} />
          <KvRow label="Validation Level" value={ssl.validationLevel === 'DV' ? 'Domain Validated (DV)' : ssl.validationLevel === 'OV' ? 'Organization Validated (OV)' : ssl.validationLevel === 'EV' ? 'Extended Validation (EV)' : 'Unknown'} />
          <KvRow label="Serial Number" value={ssl.serialNumber || '-'} mono />
          <KvRow label="Fingerprint (SHA-256)" value={ssl.fingerprintSha256 || '-'} mono />
        </Box>
        <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
          <CheckRow status={ssl.valid ? 'good' : 'bad'} label="Certificate Valid" value={ssl.valid ? 'Trusted' : 'Not trusted'} />
          <CheckRow status={ssl.domainMatch !== false ? 'good' : 'bad'} label="Domain Match (CN/SAN)" value={ssl.domainMatch !== false ? 'Matches hostname' : 'Mismatch!'} />
          <CheckRow status={ssl.daysLeft > 30 ? 'good' : ssl.daysLeft > 7 ? 'warn' : 'bad'} label="Expiry" value={ssl.daysLeft <= 0 ? 'EXPIRED' : `${ssl.daysLeft} days`} />
          <CheckRow status={ssl.isSelfSigned ? 'warn' : 'good'} label="Self-signed" value={ssl.isSelfSigned ? 'Yes — not trusted by browsers' : 'No — CA issued'} />
        </Stack>

        {/* SANs */}
        {ssl.sans?.length > 0 && (
          <Box sx={{ mb: 2, ml: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Subject Alternative Names ({ssl.sans.length})
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {ssl.sans.slice(0, 20).map((san: string) => (
                <Chip key={san} label={san} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
              ))}
              {ssl.sans.length > 20 && <Chip label={`+${ssl.sans.length - 20} more`} size="small" variant="outlined" />}
            </Stack>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* ── Section 2: Certificate Chain ── */}
        <SectionTitle icon="🔗" title="2. Certificate Chain" />
        <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
          <CheckRow status={ssl.chainValid ? 'good' : 'warn'} label="Chain Valid" value={ssl.chainValid ? `Yes (depth ${ssl.chainDepth})` : 'Invalid'} />
          <CheckRow status={!ssl.isSelfSigned ? 'good' : 'warn'} label="Trusted CA" value={ssl.isSelfSigned ? 'Self-signed' : ssl.issuerCn} />
          <CheckRow status={ssl.ocspStapling ? 'good' : 'warn'} label="OCSP Stapling" value={ssl.ocspStapling ? 'Yes — responses stapled' : 'No'} />
          <CheckRow status={!chainDetails.some((c: any, i: number) => i > 0 && c.expired) ? 'good' : 'bad'} label="Intermediate Expiry" value={chainDetails.some((c: any, i: number) => i > 0 && c.expired) ? 'Expired intermediate found!' : 'All valid'} />
        </Stack>
        {chainDetails.length > 0 && (
          <Box sx={{ ml: 1, mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Chain Details
            </Typography>
            <Stack direction="row" alignItems="center" sx={{ overflowX: 'auto', gap: 0, pb: 1 }}>
              {chainDetails.map((c, i) => (
                <Stack key={i} direction="row" alignItems="center">
                  <Paper variant="outlined" sx={{
                    p: 2, minWidth: 220, maxWidth: 260,
                    borderColor: c.expired ? '#fca5a5' : 'divider',
                    bgcolor: c.expired ? '#fef2f2' : undefined,
                  }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      Certificate {i + 1}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Common Name:</Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 1, wordBreak: 'break-word' }}>
                      {c.subject}
                    </Typography>
                    {c.organization && (
                      <>
                        <Typography variant="caption" color="text.secondary">Organization:</Typography>
                        <Typography variant="body2" sx={{ mb: 1, wordBreak: 'break-word' }}>{c.organization}</Typography>
                      </>
                    )}
                    <Typography variant="caption" color="text.secondary">Valid From:</Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {new Date(c.validFrom).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })}
                      {' to '}
                      {new Date(c.validTo).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })}
                      {c.expired && <Chip label="EXPIRED" size="small" sx={{ ml: 0.5, bgcolor: '#dc2626', color: '#fff', fontSize: '0.6rem', height: 18 }} />}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Issuer:</Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{c.issuer}</Typography>
                  </Paper>
                  {i < chainDetails.length - 1 && (
                    <Box sx={{ px: 1, flexShrink: 0 }}>
                      <ArrowForwardIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                    </Box>
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* ── Section 3: Protocol Versions ── */}
        <SectionTitle icon="📡" title="3. Protocol Versions" />
        {protocols.length > 0 ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 2, ml: 1 }}>
            {protocols.map((p) => {
              const isDeprecated = ['TLS 1.0', 'TLS 1.1'].includes(p.name);
              const isGood = p.supported && !isDeprecated;
              const isBad = p.supported && isDeprecated;
              const isGoodOff = !p.supported && isDeprecated;
              return (
                <Paper key={p.name} variant="outlined" sx={{
                  p: 1.5, textAlign: 'center',
                  borderColor: isBad ? '#fca5a5' : isGood ? '#bbf7d0' : isGoodOff ? '#bbf7d0' : 'divider',
                }}>
                  <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
                  <Typography variant="caption" sx={{
                    color: isBad ? '#dc2626' : isGood ? '#16a34a' : isGoodOff ? '#16a34a' : 'text.secondary',
                    fontWeight: 600,
                  }}>
                    {p.supported ? (isDeprecated ? 'Enabled (Insecure!)' : 'Enabled') : (isDeprecated ? 'Disabled' : 'Not supported')}
                  </Typography>
                </Paper>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ mb: 2, ml: 1 }}>
            <Typography variant="body2" color="text.secondary">Negotiated: {ssl.tlsVersion}</Typography>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* ── Section 4: Cipher Suite & Key ── */}
        <SectionTitle icon="🔐" title="4. Cipher Suite & Key" />
        <Box sx={{ ml: 1, mb: 2 }}>
          <Typography variant="caption" color="text.secondary">Negotiated Cipher Suite</Typography>
          <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
            {ssl.cipherName}{ssl.cipherBits ? ` (${ssl.cipherBits}-bit)` : ''}
          </Typography>
        </Box>
        <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
          <CheckRow status={ssl.forwardSecrecy ? 'good' : 'warn'} label="Forward Secrecy (PFS)" value={ssl.forwardSecrecy ? 'ECDHE — session keys not derivable from private key' : 'Not enabled — past traffic at risk if key leaked'} />
          <CheckRow status={!WEAK_CIPHER_RE.test(ssl.cipherName) ? 'good' : 'bad'} label="Cipher Strength" value={!WEAK_CIPHER_RE.test(ssl.cipherName) ? 'Strong (AEAD)' : 'Weak cipher detected'} />
          <CheckRow status={handshake.serverCipherOrder ? 'good' : 'warn'} label="Server Cipher Order" value={handshake.serverCipherOrder ? 'Enforced — server controls priority' : 'Not enforced — client can negotiate down'} />
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2, ml: 1 }}>
          <KvRow label="Key Algorithm" value={ssl.keyAlgorithm || '-'} />
          <KvRow label="Key Size" value={ssl.keyBits ? `${ssl.keyBits}-bit` : '-'}
            valueColor={ssl.keyBits != null && ((ssl.keyAlgorithm?.includes('RSA') && ssl.keyBits < 2048) || (ssl.keyAlgorithm?.includes('ECDSA') && ssl.keyBits < 256)) ? '#dc2626' : undefined} />
          <KvRow label="Signature Algorithm" value={ssl.signatureAlgorithm || '-'}
            valueColor={/SHA-?1|MD5/i.test(ssl.signatureAlgorithm ?? '') ? '#dc2626' : undefined} />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* ── Section 5: Known Vulnerabilities ── */}
        <SectionTitle icon="🐛" title="5. Known Vulnerabilities" />
        {vulns.length > 0 ? (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, ml: 1 }}>
              <StatusChip ok label={`${vulnSafe} Safe`} />
              {vulnWarn > 0 && <Chip size="small" label={`${vulnWarn} Warning`} sx={{ bgcolor: '#fef3c7', color: '#92400e', fontWeight: 600, fontSize: '0.75rem' }} />}
              {vulnBad > 0 && <Chip size="small" label={`${vulnBad} Vulnerable`} sx={{ bgcolor: '#fee2e2', color: '#991b1b', fontWeight: 600, fontSize: '0.75rem' }} />}
            </Stack>
            <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
              {vulns.filter((v) => v.status !== 'safe').map((v) => (
                <CheckRow key={v.id}
                  status={v.status === 'vulnerable' ? 'bad' : v.status === 'warning' ? 'warn' : 'good'}
                  label={`${v.name} (${v.cve})`}
                  value={v.detail} />
              ))}
              {vulns.filter((v) => v.status === 'safe').length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 0.5 }}>
                  {vulnSafe} checks passed: {vulns.filter((v) => v.status === 'safe').map((v) => v.name).join(', ')}
                </Typography>
              )}
            </Stack>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, ml: 1 }}>No vulnerability data available. Run a new scan.</Typography>
        )}

        <Divider sx={{ my: 2 }} />

        {/* ── Section 6: TLS Handshake ── */}
        <SectionTitle icon="🤝" title="6. TLS Handshake" />
        <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
          <CheckRow status="good" label="Handshake Time" value={handshake.timeMs ? `${handshake.timeMs}ms` : '-'} />
          <CheckRow status={handshake.alpn ? 'good' : 'warn'} label="ALPN" value={handshake.alpn ?? 'Not negotiated'} />
          <CheckRow status={handshake.secureRenegotiation ? 'good' : 'warn'} label="Secure Renegotiation" value={handshake.secureRenegotiation ? 'Supported (RFC 5746)' : 'Not supported'} />
          <CheckRow status={!handshake.compression ? 'good' : 'bad'} label="TLS Compression" value={handshake.compression ? 'Enabled (CRIME risk!)' : 'Disabled'} />
          <CheckRow status="good" label="SNI" value={handshake.sni ? 'Sent' : 'Not sent'} />
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* ── Section 7: HTTP Security Headers ── */}
        <SectionTitle icon="🛡️" title="7. HTTP Security Headers" />
        <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
          <HeaderRow label="Strict-Transport-Security (HSTS)" value={ssl.hsts ? (ssl.hstsMaxAge ? `max-age=${ssl.hstsMaxAge}${ssl.hstsIncludeSubDomains ? '; includeSubDomains' : ''}${ssl.hstsPreload ? '; preload' : ''}` : 'Present') : null} />
          <CheckRow status={ssl.httpRedirect ? 'good' : 'warn'} label="HTTP → HTTPS Redirect" value={ssl.httpRedirect ? 'Port 80 redirects to HTTPS' : 'No redirect detected'} />
          <HeaderRow label="Content-Security-Policy" value={httpHeaders.contentSecurityPolicy} />
          <HeaderRow label="X-Frame-Options" value={httpHeaders.xFrameOptions} />
          <HeaderRow label="X-Content-Type-Options" value={httpHeaders.xContentTypeOptions} />
          <HeaderRow label="Referrer-Policy" value={httpHeaders.referrerPolicy} />
          <HeaderRow label="Permissions-Policy" value={httpHeaders.permissionsPolicy} />
          <HeaderRow label="X-XSS-Protection" value={httpHeaders.xXssProtection} />
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* ── Section 8: DNS Security ── */}
        {dns && (
          <>
            <SectionTitle icon="🌐" title="8. DNS Security" />
            <Stack spacing={0.5} sx={{ mb: 2, ml: 1 }}>
              <CheckRow status={dns.spf === 'pass' ? 'good' : 'warn'} label="SPF (Sender Policy Framework)" value={dns.spf === 'pass' ? 'Configured' : 'Missing — email spoofing possible'} />
              <CheckRow status={dns.dkim === 'pass' ? 'good' : 'warn'} label="DKIM (DomainKeys)" value={dns.dkim === 'pass' ? 'Configured' : 'Missing'} />
              <CheckRow status={dns.dmarc === 'pass' ? 'good' : 'warn'} label="DMARC" value={dns.dmarc === 'pass' ? 'Configured' : 'Missing — email auth not enforced'} />
              <CheckRow status={dns.caa === 'pass' ? 'good' : 'warn'} label="CAA (Certificate Authority Authorization)" value={dns.caa === 'pass' ? 'Configured' : 'Missing — any CA can issue certs'} />
            </Stack>
          </>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Scanned: {ssl.scannedAt ? new Date(ssl.scannedAt).toLocaleString() : '-'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

const WEAK_CIPHER_RE = /RC4|3DES|DES|EXPORT|NULL|ANON/i;

// ---------------------------------------------------------------------------
// Report sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
      <span>{icon}</span> {title}
    </Typography>
  );
}

function KvRow({ label, value, valueColor, mono }: { label: string; value: string; valueColor?: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{
        fontWeight: 500, color: valueColor ?? 'text.primary',
        fontFamily: mono ? 'monospace' : undefined,
        fontSize: mono ? '0.7rem' : undefined,
        wordBreak: 'break-all',
      }}>
        {value || '-'}
      </Typography>
    </Box>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Chip
      size="small"
      icon={ok ? <CheckCircleIcon sx={{ fontSize: 16 }} /> : <CancelIcon sx={{ fontSize: 16 }} />}
      label={label}
      sx={{
        bgcolor: ok ? '#dcfce7' : '#fee2e2',
        color: ok ? '#15803d' : '#991b1b',
        fontWeight: 500,
        fontSize: '0.75rem',
        '& .MuiChip-icon': { color: ok ? '#16a34a' : '#dc2626' },
      }}
    />
  );
}

function HeaderRow({ label, value }: { label: string; value: string | null }) {
  const present = !!value;
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{
      py: 0.75, px: 1.5, borderRadius: 1,
      bgcolor: present ? 'transparent' : '#fffbeb',
    }}>
      {present
        ? <CheckCircleIcon sx={{ fontSize: 18, color: '#16a34a' }} />
        : <WarningIcon sx={{ fontSize: 18, color: '#d97706' }} />
      }
      <Typography variant="body2" sx={{ minWidth: 240, color: present ? 'text.secondary' : '#57534e' }}>{label}</Typography>
      <Typography variant="body2" sx={{
        fontWeight: 500,
        color: present ? 'text.primary' : '#1c1917',
        fontFamily: present ? 'monospace' : undefined,
        fontSize: present ? '0.75rem' : undefined,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320,
      }}>
        {present ? value : 'Missing'}
      </Typography>
    </Stack>
  );
}


function CheckRow({ status, label, value }: { status: 'good' | 'warn' | 'bad'; label: string; value: string }) {
  const Icon = status === 'good' ? CheckCircleIcon : status === 'warn' ? WarningIcon : CancelIcon;
  const color = status === 'good' ? '#16a34a' : status === 'warn' ? '#d97706' : '#dc2626';
  const hasLightBg = status === 'warn' || status === 'bad';
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{
      py: 0.75, px: 1.5, borderRadius: 1,
      bgcolor: status === 'good' ? 'transparent' : status === 'warn' ? '#fffbeb' : '#fef2f2',
    }}>
      <Icon sx={{ fontSize: 18, color }} />
      <Typography variant="body2" sx={{ minWidth: 150, color: hasLightBg ? '#57534e' : 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={{ color: hasLightBg ? '#1c1917' : 'text.primary' }}>{value}</Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 600, color: color ?? 'text.primary' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Heartbeat bar
// ---------------------------------------------------------------------------

function HeartbeatBar({ beats }: { beats: any[] }) {
  const reversed = useMemo(() => [...beats].reverse(), [beats]);
  return (
    <Stack direction="row" spacing="2px" sx={{ height: 32, alignItems: 'stretch' }}>
      {reversed.map((beat: any) => (
        <Tooltip key={beat.id}
          title={`${beat.isUp ? 'UP' : 'DOWN'} — ${beat.responseMs ?? '?'}ms${beat.statusCode ? ` (HTTP ${beat.statusCode})` : ''}${beat.error ? ` — ${beat.error}` : ''} — ${new Date(beat.createdAt).toLocaleString()}`}>
          <Box sx={{
            flex: 1, minWidth: 3, maxWidth: 10, borderRadius: '2px',
            bgcolor: beat.isUp ? '#16a34a' : '#dc2626',
            transition: 'opacity 0.15s', '&:hover': { opacity: 0.7 },
          }} />
        </Tooltip>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Response time SVG chart
// ---------------------------------------------------------------------------

function ResponseTimeChart({ data }: { data: any[] }) {
  const reversed = useMemo(() => [...data].reverse(), [data]);
  const width = 700; const height = 120;
  const pad = { top: 10, right: 10, bottom: 20, left: 45 };
  const cW = width - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;
  const vals = reversed.map((d: any) => d.responseMs ?? 0);
  const maxMs = Math.max(...vals, 1); const minMs = Math.min(...vals, 0);
  const range = maxMs - minMs || 1;
  const points = reversed.map((d: any, i: number) => ({
    x: pad.left + (i / Math.max(reversed.length - 1, 1)) * cW,
    y: pad.top + cH - (((d.responseMs ?? 0) - minMs) / range) * cH,
    isUp: d.isUp,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${pad.top + cH} L ${points[0].x} ${pad.top + cH} Z`;

  return (
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxHeight: 150 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = pad.top + cH * (1 - pct);
          const val = Math.round(minMs + range * pct);
          return (
            <g key={pct}>
              <line x1={pad.left} y1={y} x2={pad.left + cW} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={pad.left - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{val}ms</text>
            </g>
          );
        })}
        <path d={areaPath} fill="#3b82f6" opacity={0.1} />
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={p.isUp ? '#3b82f6' : '#dc2626'} />
        ))}
      </svg>
    </Box>
  );
}
