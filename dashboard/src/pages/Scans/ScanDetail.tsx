import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, Stack, Paper, Skeleton, Alert,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  TablePagination, IconButton, CircularProgress, Collapse,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import StopIcon from '@mui/icons-material/Stop';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
  useScan, useCancelScan, useDeleteScan,
  type Scan, type Finding,
} from '../../api/hooks.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_COLOR: Record<string, string> = {
  critical: '#d32f2f', high: '#f44336', medium: '#ff9800', low: '#2196f3', info: '#9e9e9e',
};
const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  completed: 'success', failed: 'error', running: 'info', pending: 'default', cancelled: 'warning',
};
const CHIP_LIMIT = 5;
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const scanQuery = useScan(id ?? '');
  const cancelScan = useCancelScan();
  const deleteScan = useDeleteScan();

  const scan = scanQuery.data?.data as Scan | undefined;
  const findings = (scan?.findings ?? []) as Finding[];

  const canCancel = scan?.status === 'pending' || scan?.status === 'running';
  const canDelete = scan?.status === 'completed' || scan?.status === 'failed' || scan?.status === 'cancelled';

  const handleDelete = () => {
    if (!id) return;
    if (confirm('Delete this scan and its findings? This cannot be undone.')) {
      deleteScan.mutate(id, { onSuccess: () => navigate(-1) });
    }
  };

  const handleCancel = () => {
    if (!id) return;
    cancelScan.mutate(id);
  };

  if (scanQuery.isLoading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={60} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={120} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={400} />
      </Box>
    );
  }

  if (!scan) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>Back</Button>
        <Alert severity="error">Scan not found</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <IconButton onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="h5" sx={{ fontWeight: 600 }}>Scan Details</Typography>
              <Chip
                label={scan.status}
                size="small"
                color={STATUS_COLOR[scan.status] ?? 'default'}
                icon={scan.status === 'completed' ? <CheckCircleIcon /> : scan.status === 'failed' ? <ErrorIcon /> : undefined}
              />
            </Stack>
            {scan.repository && (
              <Typography variant="body2" color="text.secondary">
                {scan.repository.owner}/{scan.repository.name}
              </Typography>
            )}
          </Box>
        </Stack>

        <Stack direction="row" spacing={1}>
          {canCancel && (
            <Button
              variant="outlined"
              color="warning"
              startIcon={cancelScan.isPending ? <CircularProgress size={16} /> : <StopIcon />}
              onClick={handleCancel}
              disabled={cancelScan.isPending}
            >
              Cancel Scan
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outlined"
              color="error"
              startIcon={deleteScan.isPending ? <CircularProgress size={16} /> : <DeleteIcon />}
              onClick={handleDelete}
              disabled={deleteScan.isPending}
            >
              Delete
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Overview cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 3 }}>
        <InfoCard label="Scan Type" value={scan.scanType.replace(/_/g, ' ')} />
        <InfoCard label="Trigger" value={scan.trigger} />
        <InfoCard label="Duration" value={formatDuration(scan.durationMs)} />
        <InfoCard label="Started" value={scan.startedAt ? new Date(scan.startedAt).toLocaleString() : '--'} />
        <InfoCard label="Completed" value={scan.completedAt ? new Date(scan.completedAt).toLocaleString() : '--'} />
        <InfoCard label="Findings" value={String(scan.findingsTotal)} />
      </Box>

      {/* Ecosystems + Scanners row */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        {scan.metadata?.ecosystems && scan.metadata.ecosystems.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Detected Ecosystems</Typography>
            <CollapsibleChips
              items={scan.metadata.ecosystems.map((eco, i) => ({
                key: `${eco.name}-${i}`,
                label: eco.subdir ? `${eco.language} (${eco.name}) - ${eco.subdir}` : `${eco.language} (${eco.name})`,
                color: 'default' as const,
                variant: 'outlined' as const,
              }))}
            />
          </Paper>
        )}

        {((scan.metadata?.scannersRun?.length ?? 0) > 0 || (scan.metadata?.scannersSkipped?.length ?? 0) > 0) && (
          <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Scanners</Typography>
            <CollapsibleChips
              items={[
                ...(scan.metadata?.scannersRun ?? []).map((s) => ({
                  key: `run-${s}`,
                  label: s,
                  color: 'success' as const,
                  variant: 'outlined' as const,
                })),
                ...(scan.metadata?.scannersSkipped ?? []).map((s) => ({
                  key: `skip-${s}`,
                  label: `${s} (skipped)`,
                  color: 'warning' as const,
                  variant: 'outlined' as const,
                })),
              ]}
            />
          </Paper>
        )}
      </Stack>

      {/* Warnings */}
      {scan.metadata?.warnings && scan.metadata.warnings.length > 0 && (
        <Alert severity="warning" variant="outlined" icon={<WarningAmberIcon />} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Scan Incomplete - Missing Tools</Typography>
          {scan.metadata.warnings.map((w, i) => (
            <Typography key={i} variant="body2" sx={{ mb: 0.5 }}>{w}</Typography>
          ))}
        </Alert>
      )}

      {/* Error */}
      {scan.errorMessage && (
        <Alert severity="error" variant="outlined" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Error</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{scan.errorMessage}</Typography>
        </Alert>
      )}

      {/* Findings with severity filter */}
      {scan.status === 'completed' && (
        <FindingsSection findings={findings} scannersSkipped={scan.metadata?.scannersSkipped} />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Collapsible chips (show N, expand to show all)
// ---------------------------------------------------------------------------

interface ChipItem {
  key: string;
  label: string;
  color: 'default' | 'success' | 'warning' | 'error' | 'info';
  variant: 'outlined' | 'filled';
}

function CollapsibleChips({ items, limit = CHIP_LIMIT }: { items: ChipItem[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  const hiddenCount = items.length - limit;

  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
      {visible.map((item) => (
        <Chip key={item.key} label={item.label} size="small" color={item.color} variant={item.variant} />
      ))}
      {hiddenCount > 0 && (
        <Chip
          label={expanded ? 'Show less' : `+${hiddenCount} more`}
          size="small"
          variant="filled"
          color="default"
          onClick={() => setExpanded(!expanded)}
          onDelete={() => setExpanded(!expanded)}
          deleteIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ cursor: 'pointer' }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Findings section: severity filter badges + paginated table
// ---------------------------------------------------------------------------

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

function FindingsSection({ findings, scannersSkipped }: { findings: Finding[]; scannersSkipped?: string[] }) {
  const [activeSeverity, setActiveSeverity] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of findings) {
      c[f.severity] = (c[f.severity] ?? 0) + 1;
    }
    return c;
  }, [findings]);

  const filtered = useMemo(
    () => {
      const base = activeSeverity ? findings.filter((f) => f.severity === activeSeverity) : findings;
      return [...base].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
    },
    [findings, activeSeverity],
  );

  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const handleSeverityClick = (sev: string) => {
    setActiveSeverity(activeSeverity === sev ? null : sev);
    setPage(0);
  };

  if (findings.length === 0) {
    return (
      <Paper sx={{ py: 4, textAlign: 'center' }}>
        {(scannersSkipped?.length ?? 0) > 0 ? (
          <>
            <WarningAmberIcon sx={{ fontSize: 40, color: 'warning.main', mb: 1 }} />
            <Typography color="text.secondary">
              No vulnerabilities found, but some scanners were skipped due to missing tools
            </Typography>
          </>
        ) : (
          <>
            <CheckCircleIcon sx={{ fontSize: 40, color: 'success.main', mb: 1 }} />
            <Typography color="text.secondary">No vulnerabilities found</Typography>
          </>
        )}
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Severity filter badges */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        {SEVERITIES.map((sev) => {
          const count = counts[sev] ?? 0;
          if (count === 0) return null;
          const isActive = activeSeverity === sev;
          return (
            <Chip
              key={sev}
              label={`${sev}: ${count}`}
              size="small"
              onClick={() => handleSeverityClick(sev)}
              sx={{
                bgcolor: isActive ? SEVERITY_COLOR[sev] : 'transparent',
                color: isActive ? '#fff' : SEVERITY_COLOR[sev],
                border: `1.5px solid ${SEVERITY_COLOR[sev]}`,
                fontWeight: 600,
                cursor: 'pointer',
                '&:hover': { bgcolor: SEVERITY_COLOR[sev], color: '#fff', opacity: isActive ? 1 : 0.85 },
              }}
            />
          );
        })}
        <Chip
          label={`${findings.length} total`}
          size="small"
          variant={activeSeverity === null ? 'filled' : 'outlined'}
          onClick={() => { setActiveSeverity(null); setPage(0); }}
          sx={{ cursor: 'pointer' }}
        />
        {activeSeverity && (
          <Typography variant="caption" color="text.secondary">
            Showing {filtered.length} of {findings.length}
          </Typography>
        )}
      </Stack>

      {/* Table */}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={40} />
                <TableCell width={100}>Severity</TableCell>
                <TableCell>Title</TableCell>
                <TableCell width={140}>CVE</TableCell>
                <TableCell width={80} align="center">CVSS</TableCell>
                <TableCell width={100}>Source</TableCell>
                <TableCell width={100} align="center">Auto-fix</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.map((f) => (
                <FindingTableRow
                  key={f.id}
                  finding={f}
                  expanded={expandedId === f.id}
                  onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
        />
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Single finding row with expandable detail
// ---------------------------------------------------------------------------

function FindingTableRow({ finding, expanded, onToggle }: {
  finding: Finding;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detail = finding.detail ?? {};

  return (
    <>
      <TableRow
        hover
        sx={{ cursor: 'pointer', '& > *': { borderBottom: expanded ? 'none' : undefined } }}
        onClick={onToggle}
      >
        <TableCell>
          <IconButton size="small">
            {expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Chip
            label={finding.severity}
            size="small"
            sx={{
              bgcolor: SEVERITY_COLOR[finding.severity] ?? '#9e9e9e',
              color: '#fff',
              fontWeight: 600,
              minWidth: 64,
            }}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{finding.title}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {finding.cveId || '--'}
          </Typography>
        </TableCell>
        <TableCell align="center">
          {finding.cvssScore != null ? (
            <Chip label={Number(finding.cvssScore).toFixed(1)} size="small" variant="outlined" />
          ) : '--'}
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="text.secondary">{finding.source ?? '--'}</Typography>
        </TableCell>
        <TableCell align="center">
          {finding.autoFixable && <Chip label="Yes" size="small" color="success" variant="outlined" />}
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      <TableRow>
        <TableCell colSpan={7} sx={{ p: 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ px: 3, py: 2, bgcolor: 'action.hover' }}>
              {finding.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {finding.description}
                </Typography>
              )}

              {Object.keys(detail).length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>
                    Details
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
                    {Object.entries(detail).map(([key, val]) => {
                      if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return null;
                      const display = Array.isArray(val) ? val.join(', ') : String(val);
                      if (display.length > 300) return null;
                      return [
                        <Typography key={`${key}-l`} variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {key}:
                        </Typography>,
                        <Typography key={`${key}-v`} variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          {display}
                        </Typography>,
                      ];
                    })}
                  </Box>
                </Box>
              )}

              {finding.remediation && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>
                    Remediation
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.paper' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                      {finding.remediation}
                    </Typography>
                  </Paper>
                </Box>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
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

function formatDuration(ms?: number | null): string {
  if (!ms) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
