import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, Stack, Paper, Skeleton, Alert,
  IconButton, Tooltip, CircularProgress, Collapse,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SecurityIcon from '@mui/icons-material/Security';
import LockIcon from '@mui/icons-material/Lock';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import {
  useEndpointDetail, useTriggerEndpointCheck,
  type Heartbeat, type UptimePeriod, type EndpointCertificate, type EndpointFinding,
} from '../../api/hooks.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEAT_COLORS: Record<string, string> = {
  up: '#16a34a',
  degraded: '#f59e0b',
  down: '#dc2626',
};

const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  healthy: { color: '#16a34a', text: 'Up' },
  unhealthy: { color: '#f59e0b', text: 'Degraded' },
  unreachable: { color: '#dc2626', text: 'Down' },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EndpointDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useEndpointDetail(id ?? '');
  const triggerCheck = useTriggerEndpointCheck();
  const [scanTriggered, setScanTriggered] = useState(false);

  const ep = query.data?.data;

  if (query.isLoading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={80} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={200} />
      </Box>
    );
  }

  if (!ep) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>Back</Button>
        <Alert severity="error">Endpoint not found</Alert>
      </Box>
    );
  }

  const statusInfo = STATUS_LABEL[ep.lastStatus ?? ''] ?? { color: '#9e9e9e', text: 'Pending' };
  const heartbeats = ep.heartbeats ?? [];
  const uptime = ep.uptime ?? {};
  const responseHistory = ep.responseHistory ?? [];
  const certificate = ep.certificate ?? null;
  const findings = ep.findings ?? [];

  const handleScan = () => {
    setScanTriggered(true);
    triggerCheck.mutate(ep.id, {
      onSettled: () => {
        // Wait a few seconds for the job to process, then refresh
        setTimeout(() => setScanTriggered(false), 8000);
      },
    });
  };

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: statusInfo.color, flexShrink: 0 }} />
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {ep.host}{ep.port !== 443 ? `:${ep.port}` : ''}
            </Typography>
            <Chip label={statusInfo.text} size="small" sx={{ bgcolor: statusInfo.color, color: '#fff', fontWeight: 600 }} />
          </Stack>
          {ep.label && <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>{ep.label}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {ep.project && (
            <Chip
              icon={<FolderIcon />}
              label={ep.project.name}
              variant="outlined"
              component={Link}
              to={`/projects/${ep.project.id}`}
              clickable
            />
          )}
          <Button
            variant="contained"
            startIcon={scanTriggered ? <CircularProgress size={16} color="inherit" /> : <SecurityIcon />}
            onClick={handleScan}
            disabled={triggerCheck.isPending || scanTriggered}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {scanTriggered ? 'Scanning...' : 'Run SSL Scan'}
          </Button>
        </Stack>
      </Stack>

      {scanTriggered && (
        <Alert severity="info" sx={{ mb: 2 }}>
          SSL scan queued. Results will appear below shortly...
        </Alert>
      )}

      {/* Uptime cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        {/* SSL Score card — first position */}
        <SslScoreCard tls={ep.lastTlsInfo} />
        {(['24h', '7d', '30d'] as const).map((period) => {
          const u = uptime[period];
          if (!u) return null;
          return <UptimeCard key={period} period={period} data={u} />;
        })}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">Check Interval</Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{ep.checkInterval}</Typography>
        </Paper>
        {ep.lastResponseMs != null && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Last Response</Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>{ep.lastResponseMs}ms</Typography>
          </Paper>
        )}
        {heartbeats.length > 0 && heartbeats[heartbeats.length - 1].certDaysLeft != null && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">Cert Expires In</Typography>
            <Typography variant="h6" sx={{ fontWeight: 600, color: (heartbeats[heartbeats.length - 1].certDaysLeft ?? 999) <= 30 ? '#f59e0b' : 'text.primary' }}>
              {heartbeats[heartbeats.length - 1].certDaysLeft} days
            </Typography>
          </Paper>
        )}
      </Box>

      {/* Tags */}
      {Object.keys(ep.tags ?? {}).length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
          {Object.entries(ep.tags).map(([k, v]) => (
            <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
          ))}
        </Stack>
      )}

      {/* SSL Scan Results */}
      {ep.lastTlsInfo && <TlsScanResults tls={ep.lastTlsInfo} />}

      {/* SSL Certificate */}
      {certificate && <CertificateCard cert={certificate} />}

      {/* SSL Findings */}
      {findings.length > 0 && <FindingsSection findings={findings} />}

      {/* Heartbeat bar */}
      {heartbeats.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2">Heartbeat</Typography>
            <Typography variant="caption" color="text.secondary">
              {heartbeats.length} checks
            </Typography>
          </Stack>
          <HeartbeatBar beats={heartbeats} />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {new Date(heartbeats[0].createdAt).toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(heartbeats[heartbeats.length - 1].createdAt).toLocaleString()}
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Response time chart */}
      {responseHistory.length > 1 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Response Time</Typography>
          <ResponseTimeChart data={responseHistory} />
        </Paper>
      )}

      {/* Recent checks table */}
      {heartbeats.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Recent Checks</Typography>
          <Stack spacing={0.5}>
            {[...heartbeats].reverse().slice(0, 20).map((beat) => (
              <Stack
                key={beat.id}
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ py: 0.75, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <Box sx={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  bgcolor: BEAT_COLORS[beat.status] ?? '#9e9e9e',
                }} />
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 60 }}>
                  {beat.status === 'up' ? 'Up' : beat.status === 'degraded' ? 'Degraded' : 'Down'}
                </Typography>
                {beat.statusCode && (
                  <Chip label={`HTTP ${beat.statusCode}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {beat.message ?? ''}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {beat.responseMs}ms
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(beat.createdAt).toLocaleTimeString()}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {heartbeats.length === 0 && (
        <Paper sx={{ py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No checks recorded yet. First check is in progress...</Typography>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SSL Grade computation (shared)
// ---------------------------------------------------------------------------

import type { TlsScanInfo } from '../../api/hooks.js';

function computeSslGrade(tls: TlsScanInfo): { grade: string; color: string; bg: string; note: string } {
  const isWeakProtocol = tls.tlsVersion ? ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'].includes(tls.tlsVersion) : false;
  const isSslProtocol = tls.tlsVersion ? tls.tlsVersion.startsWith('SSL') : false;
  const weakCiphers = ['RC4', '3DES', 'DES', 'EXPORT', 'NULL', 'ANON'];
  const isWeakCipher = tls.cipherName ? weakCiphers.some((wc) => tls.cipherName!.toUpperCase().includes(wc)) : false;
  const isWeakSig = tls.signatureAlgorithm ? ['SHA1', 'MD5'].some((w) => tls.signatureAlgorithm.toUpperCase().includes(w)) : false;
  const isMd5 = tls.signatureAlgorithm?.toUpperCase().includes('MD5');
  const isWeakKey = tls.keyBits != null && (
    (tls.keyAlgorithm.startsWith('RSA') && tls.keyBits < 2048) ||
    (tls.keyAlgorithm.startsWith('ECDSA') && tls.keyBits < 256)
  );
  const certExpired = (tls.certDaysLeft ?? 999) <= 0;

  const criticals = [isSslProtocol, certExpired, isMd5].filter(Boolean).length;
  const highs = [isWeakProtocol && !isSslProtocol, isWeakCipher, isWeakKey, isWeakSig && !isMd5, !certExpired && (tls.certDaysLeft ?? 999) <= 7].filter(Boolean).length;
  const mediums = [!tls.forwardSecrecy, !tls.hsts, !tls.chainValid, tls.isSelfSigned].filter(Boolean).length;

  if (criticals > 0) return { grade: 'F', color: '#991b1b', bg: '#fef2f2', note: 'Critical issues — immediate action required' };
  if (highs > 0) return { grade: 'C', color: '#c2410c', bg: '#fff7ed', note: 'Significant weaknesses found' };
  if (mediums > 2) return { grade: 'B-', color: '#a16207', bg: '#fefce8', note: 'Several improvements recommended' };
  if (mediums > 0) return { grade: 'B+', color: '#1d4ed8', bg: '#eff6ff', note: 'Good, minor improvements possible' };
  if (tls.tlsVersion === 'TLSv1.3' && tls.forwardSecrecy && tls.hsts) return { grade: 'A+', color: '#15803d', bg: '#f0fdf4', note: 'Excellent — best practices met' };
  return { grade: 'A', color: '#16a34a', bg: '#f0fdf4', note: 'Strong configuration' };
}

// ---------------------------------------------------------------------------
// SSL Score card (top summary area)
// ---------------------------------------------------------------------------

function SslScoreCard({ tls }: { tls: TlsScanInfo | null }) {
  if (!tls) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">SSL Score</Typography>
        <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.disabled' }}>--</Typography>
        <Typography variant="caption" color="text.disabled">Not scanned yet</Typography>
      </Paper>
    );
  }

  const { grade, color, bg, note } = computeSslGrade(tls);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: color + '60', bgcolor: bg }}>
      <Typography variant="caption" color="text.secondary">SSL Score</Typography>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{
          width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: color, color: '#fff', fontWeight: 800, fontSize: grade.length > 1 ? '0.85rem' : '1.1rem',
          boxShadow: `0 0 0 3px ${color}22`,
        }}>
          {grade}
        </Box>
        <Typography variant="caption" sx={{ color, fontWeight: 500 }}>{note}</Typography>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// TLS Scan Results — protocol, cipher, security posture overview
// ---------------------------------------------------------------------------

/** A single checklist row: green/yellow/red dot + value + note when bad */
function CheckRow({ status, label, value, note }: { status: 'good' | 'warn' | 'bad'; label: string; value: string; note?: string }) {
  const dotColor = status === 'good' ? '#16a34a' : status === 'warn' ? '#f59e0b' : '#dc2626';
  const textColor = status === 'good' ? 'text.primary' : status === 'warn' ? '#92400e' : '#991b1b';
  return (
    <Box sx={{
      py: 1, px: 1.5, borderRadius: 1,
      bgcolor: status === 'good' ? 'transparent' : status === 'warn' ? '#fffbeb' : '#fef2f2',
    }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: dotColor, flexShrink: 0 }} />
        <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 120, color: 'text.secondary' }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, color: textColor, flex: 1 }}>{value}</Typography>
      </Stack>
      {note && status !== 'good' && (
        <Typography variant="caption" sx={{ display: 'block', ml: 3.5, mt: 0.25, color: textColor, fontStyle: 'italic' }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}

function TlsScanResults({ tls }: { tls: TlsScanInfo }) {
  // --- Evaluate each check ---
  const isWeakProtocol = tls.tlsVersion ? ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'].includes(tls.tlsVersion) : false;
  const isSslProtocol = tls.tlsVersion ? tls.tlsVersion.startsWith('SSL') : false;
  const weakCiphers = ['RC4', '3DES', 'DES', 'EXPORT', 'NULL', 'ANON'];
  const isWeakCipher = tls.cipherName ? weakCiphers.some((wc) => tls.cipherName!.toUpperCase().includes(wc)) : false;
  const isWeakSig = tls.signatureAlgorithm ? ['SHA1', 'MD5'].some((w) => tls.signatureAlgorithm.toUpperCase().includes(w)) : false;
  const isMd5 = tls.signatureAlgorithm?.toUpperCase().includes('MD5');
  const isWeakKey = tls.keyBits != null && (
    (tls.keyAlgorithm.startsWith('RSA') && tls.keyBits < 2048) ||
    (tls.keyAlgorithm.startsWith('ECDSA') && tls.keyBits < 256)
  );
  const certExpired = (tls.certDaysLeft ?? 999) <= 0;
  const certExpiringSoon = !certExpired && (tls.certDaysLeft ?? 999) <= 30;

  // --- Grade (use shared computation) ---
  const { grade, color: gradeColor, bg: gradeBg } = computeSslGrade(tls);

  const gradeNotes: Record<string, string> = {
    'F': 'Critical security issues detected. This endpoint is vulnerable and requires immediate attention.',
    'C': 'Significant security weaknesses found. This configuration does not meet modern standards.',
    'B-': 'Several improvements recommended. The connection is functional but lacks best-practice hardening.',
    'B+': 'Good overall, with minor improvements possible.',
    'A+': 'Excellent. This endpoint follows all SSL/TLS best practices.',
    'A': 'Strong security configuration. No issues detected.',
  };
  const gradeNote = gradeNotes[grade] ?? 'No issues detected.';

  const validationLabels: Record<string, string> = { DV: 'Domain Validated', OV: 'Organization Validated', EV: 'Extended Validation', unknown: 'Unknown' };

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderColor: gradeColor + '40' }}>
      {/* Header + Grade */}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <SecurityIcon sx={{ color: gradeColor, fontSize: 24 }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>SSL/TLS Scan Results</Typography>
        <Box sx={{
          width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: gradeColor, color: '#fff', fontWeight: 800, fontSize: grade.length > 1 ? '0.9rem' : '1.1rem',
          boxShadow: `0 0 0 3px ${gradeColor}22`,
        }}>
          {grade}
        </Box>
      </Stack>

      {/* Grade note banner */}
      <Box sx={{ px: 2, py: 1.5, borderRadius: 1, bgcolor: gradeBg, mb: 2.5, borderLeft: `4px solid ${gradeColor}` }}>
        <Typography variant="body2" sx={{ color: gradeColor, fontWeight: 500 }}>
          {gradeNote}
        </Typography>
      </Box>

      {/* Metric cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2, mb: 2.5 }}>
        {/* Protocol */}
        <Paper variant="outlined" sx={{ p: 1.5, borderColor: isWeakProtocol ? '#fca5a5' : '#bbf7d0' }}>
          <Typography variant="caption" color="text.secondary">Protocol</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: isWeakProtocol ? '#dc2626' : '#16a34a' }}>
            {tls.tlsVersion ?? 'N/A'}
          </Typography>
          <Typography variant="caption" sx={{ color: isWeakProtocol ? '#991b1b' : '#166534' }}>
            {isWeakProtocol
              ? isSslProtocol ? 'Critically insecure protocol' : 'Deprecated — upgrade to TLS 1.2+'
              : tls.tlsVersion === 'TLSv1.3' ? 'Latest and most secure' : 'Secure'}
          </Typography>
        </Paper>

        {/* Cipher Suite */}
        <Paper variant="outlined" sx={{ p: 1.5, borderColor: isWeakCipher ? '#fca5a5' : !tls.forwardSecrecy ? '#fde68a' : '#bbf7d0' }}>
          <Typography variant="caption" color="text.secondary">Cipher Suite</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', color: isWeakCipher ? '#dc2626' : 'text.primary' }}>
            {tls.cipherName ?? 'N/A'}
          </Typography>
          <Typography variant="caption" sx={{ color: isWeakCipher ? '#991b1b' : !tls.forwardSecrecy ? '#92400e' : '#166534' }}>
            {isWeakCipher
              ? 'Weak cipher — vulnerable to attacks'
              : tls.forwardSecrecy ? 'Strong with forward secrecy' : 'No forward secrecy'}
          </Typography>
        </Paper>

        {/* Key */}
        <Paper variant="outlined" sx={{ p: 1.5, borderColor: isWeakKey ? '#fca5a5' : '#d4d4d8' }}>
          <Typography variant="caption" color="text.secondary">Key Algorithm</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: isWeakKey ? '#dc2626' : 'text.primary' }}>
            {tls.keyAlgorithm}
          </Typography>
          <Typography variant="caption" sx={{ color: isWeakKey ? '#991b1b' : '#166534' }}>
            {isWeakKey
              ? `${tls.keyBits} bits — too weak, minimum ${tls.keyAlgorithm.startsWith('RSA') ? '2048' : '256'} required`
              : `${tls.keyBits ?? '?'} bits${tls.keyAlgorithm.startsWith('RSA') && (tls.keyBits ?? 0) >= 4096 ? ' — excellent' : ''}`}
          </Typography>
        </Paper>

        {/* Validation Level */}
        <Paper variant="outlined" sx={{ p: 1.5, borderColor: tls.validationLevel === 'EV' ? '#bbf7d0' : '#d4d4d8' }}>
          <Typography variant="caption" color="text.secondary">Certificate Type</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: tls.validationLevel === 'EV' ? '#16a34a' : tls.validationLevel === 'OV' ? '#2563eb' : 'text.secondary' }}>
            {tls.validationLevel}
          </Typography>
          <Typography variant="caption" color="text.secondary">{validationLabels[tls.validationLevel] ?? ''}</Typography>
        </Paper>
      </Box>

      {/* Security checklist */}
      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fafafa' }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Security Checklist</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.5 }}>
          <CheckRow
            status={isWeakProtocol ? (isSslProtocol ? 'bad' : 'bad') : 'good'}
            label="Protocol"
            value={tls.tlsVersion ?? 'N/A'}
            note={isSslProtocol ? 'SSL is obsolete and has critical vulnerabilities (POODLE)' : isWeakProtocol ? 'TLS 1.0/1.1 are deprecated and vulnerable to BEAST' : undefined}
          />
          <CheckRow
            status={isWeakCipher ? 'bad' : 'good'}
            label="Cipher Strength"
            value={isWeakCipher ? 'Weak' : 'Strong (AEAD)'}
            note={isWeakCipher ? 'Using a broken cipher — switch to AES-GCM or CHACHA20' : undefined}
          />
          <CheckRow
            status={tls.forwardSecrecy ? 'good' : 'warn'}
            label="Forward Secrecy"
            value={tls.forwardSecrecy ? 'Enabled (ECDHE)' : 'Not enabled'}
            note={!tls.forwardSecrecy ? 'Past traffic can be decrypted if the private key is ever compromised' : undefined}
          />
          <CheckRow
            status={tls.hsts ? 'good' : 'warn'}
            label="HSTS Header"
            value={tls.hsts ? 'Present' : 'Missing'}
            note={!tls.hsts ? 'Users are vulnerable to protocol downgrade and cookie hijacking attacks' : undefined}
          />
          <CheckRow
            status={tls.chainValid ? 'good' : 'warn'}
            label="Certificate Chain"
            value={tls.chainValid ? `Valid (depth ${tls.chainDepth})` : 'Invalid'}
            note={!tls.chainValid ? 'Incomplete chain may break connections on mobile or older browsers' : undefined}
          />
          <CheckRow
            status={tls.isSelfSigned ? 'warn' : 'good'}
            label="Trusted CA"
            value={tls.isSelfSigned ? 'Self-signed' : tls.issuerCn}
            note={tls.isSelfSigned ? 'Browsers will show a security warning to visitors' : undefined}
          />
          <CheckRow
            status={isWeakSig ? 'bad' : 'good'}
            label="Signature Algorithm"
            value={tls.signatureAlgorithm}
            note={isMd5 ? 'MD5 is trivially forgeable — reissue immediately' : isWeakSig ? 'SHA-1 is broken and rejected by modern browsers' : undefined}
          />
          <CheckRow
            status={isWeakKey ? 'bad' : 'good'}
            label="Key Strength"
            value={`${tls.keyAlgorithm} ${tls.keyBits ?? '?'}-bit`}
            note={isWeakKey ? `Minimum ${tls.keyAlgorithm.startsWith('RSA') ? '2048' : '256'} bits required` : undefined}
          />
          <CheckRow
            status={certExpired ? 'bad' : certExpiringSoon ? 'warn' : 'good'}
            label="Certificate Expiry"
            value={certExpired ? `Expired ${Math.abs(tls.certDaysLeft)} days ago` : `${tls.certDaysLeft} days remaining`}
            note={certExpired ? 'Browsers will block access to this site' : certExpiringSoon ? 'Renew soon to avoid service disruption' : undefined}
          />
        </Box>
      </Paper>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Last scanned: {new Date(tls.scannedAt).toLocaleString()}
      </Typography>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// SSL Certificate card
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: '#991b1b', bg: '#fef2f2', label: 'Critical' },
  high: { color: '#c2410c', bg: '#fff7ed', label: 'High' },
  medium: { color: '#a16207', bg: '#fefce8', label: 'Medium' },
  low: { color: '#1d4ed8', bg: '#eff6ff', label: 'Low' },
  info: { color: '#6b7280', bg: '#f9fafb', label: 'Info' },
};

function CertificateCard({ cert }: { cert: EndpointCertificate }) {
  const daysLeft = Math.floor((new Date(cert.notAfter).getTime() - Date.now()) / 86400000);
  const statusColor = daysLeft <= 0 ? '#dc2626' : daysLeft <= 30 ? '#f59e0b' : '#16a34a';
  const chainLabel = cert.chainValid === true ? 'Valid' : cert.chainValid === false ? 'Invalid' : 'Unknown';

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <LockIcon sx={{ color: statusColor, fontSize: 20 }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>SSL Certificate</Typography>
        <Chip label={cert.status} size="small" sx={{ bgcolor: statusColor, color: '#fff', fontWeight: 600, textTransform: 'capitalize' }} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Subject</Typography>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{cert.subjectCn}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Issuer</Typography>
          <Typography variant="body2">{cert.issuerCn}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Expires</Typography>
          <Typography variant="body2" sx={{ fontWeight: 500, color: statusColor }}>
            {daysLeft <= 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft} days`}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Key Algorithm</Typography>
          <Typography variant="body2">{cert.keyAlgorithm}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Signature</Typography>
          <Typography variant="body2">{cert.signatureAlgorithm}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Chain</Typography>
          <Typography variant="body2">
            {chainLabel}{cert.chainDepth != null ? ` (depth: ${cert.chainDepth})` : ''}
          </Typography>
        </Box>
        {cert.sans.length > 0 && (
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="caption" color="text.secondary">SANs</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {cert.sans.slice(0, 10).map((san) => (
                <Chip key={san} label={san} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
              ))}
              {cert.sans.length > 10 && (
                <Chip label={`+${cert.sans.length - 10} more`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
              )}
            </Stack>
          </Box>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Last checked: {new Date(cert.lastCheckedAt).toLocaleString()} | Serial: {cert.serialNumber.slice(0, 16)}...
      </Typography>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Findings section
// ---------------------------------------------------------------------------

function FindingsSection({ findings }: { findings: EndpointFinding[] }) {
  const [expanded, setExpanded] = useState(true);
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;

  return (
    <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
        onClick={() => setExpanded(!expanded)}
      >
        <SecurityIcon sx={{ fontSize: 20, color: criticalCount > 0 ? '#dc2626' : highCount > 0 ? '#f59e0b' : '#16a34a' }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          SSL Scan Findings
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {criticalCount > 0 && <Chip label={`${criticalCount} critical`} size="small" sx={{ bgcolor: '#fef2f2', color: '#991b1b', fontWeight: 600, fontSize: '0.7rem' }} />}
          {highCount > 0 && <Chip label={`${highCount} high`} size="small" sx={{ bgcolor: '#fff7ed', color: '#c2410c', fontWeight: 600, fontSize: '0.7rem' }} />}
          <Chip label={`${findings.length} total`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
        </Stack>
        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </Stack>

      <Collapse in={expanded}>
        <Stack spacing={0} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
          {findings.map((f) => {
            const sev = SEVERITY_CONFIG[f.severity] ?? SEVERITY_CONFIG.info;
            return (
              <Stack
                key={f.id}
                direction="row"
                spacing={1.5}
                alignItems="flex-start"
                sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}
              >
                <Chip
                  label={sev.label}
                  size="small"
                  sx={{ bgcolor: sev.bg, color: sev.color, fontWeight: 600, fontSize: '0.65rem', minWidth: 60, mt: 0.25 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{f.title}</Typography>
                  {f.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {f.description}
                    </Typography>
                  )}
                  {f.remediation && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#059669', fontStyle: 'italic' }}>
                      Fix: {f.remediation}
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {new Date(f.createdAt).toLocaleDateString()}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Uptime card
// ---------------------------------------------------------------------------

function UptimeCard({ period, data }: { period: string; data: UptimePeriod }) {
  const color = data.pct >= 99 ? '#16a34a' : data.pct >= 95 ? '#f59e0b' : '#dc2626';
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">Uptime ({period})</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, color }}>
        {data.pct}%
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {data.up}/{data.total} checks | avg {data.avgResponseMs}ms
      </Typography>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Heartbeat bar — row of colored pills like Uptime Kuma
// ---------------------------------------------------------------------------

function HeartbeatBar({ beats }: { beats: Heartbeat[] }) {
  return (
    <Stack direction="row" spacing="2px" sx={{ height: 32, alignItems: 'stretch' }}>
      {beats.map((beat) => (
        <Tooltip
          key={beat.id}
          title={`${beat.status.toUpperCase()} — ${beat.responseMs}ms${beat.statusCode ? ` (HTTP ${beat.statusCode})` : ''}${beat.message ? ` — ${beat.message}` : ''} — ${new Date(beat.createdAt).toLocaleString()}`}
        >
          <Box
            sx={{
              flex: 1,
              minWidth: 3,
              maxWidth: 10,
              borderRadius: '2px',
              bgcolor: BEAT_COLORS[beat.status] ?? '#9e9e9e',
              transition: 'opacity 0.15s',
              '&:hover': { opacity: 0.7 },
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Response time chart — simple SVG line chart
// ---------------------------------------------------------------------------

function ResponseTimeChart({ data }: { data: Array<{ time: string; ms: number; status: string }> }) {
  const width = 700;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxMs = Math.max(...data.map((d) => d.ms), 1);
  const minMs = Math.min(...data.map((d) => d.ms), 0);
  const range = maxMs - minMs || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((d.ms - minMs) / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`;

  return (
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxHeight: 150 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padding.top + chartH * (1 - pct);
          const val = Math.round(minMs + range * pct);
          return (
            <g key={pct}>
              <line x1={padding.left} y1={y} x2={padding.left + chartW} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={padding.left - 5} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{val}ms</text>
            </g>
          );
        })}
        {/* Area fill */}
        <path d={areaPath} fill="#3b82f6" opacity={0.1} />
        {/* Line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {/* Dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={2.5}
            fill={BEAT_COLORS[p.status] ?? '#3b82f6'}
          />
        ))}
      </svg>
    </Box>
  );
}
