import { useState, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  CircularProgress,
  TablePagination,
  TextField,
  IconButton,
  InputAdornment,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import GitHubIcon from '@mui/icons-material/GitHub';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import LockIcon from '@mui/icons-material/Lock';
import BugReportIcon from '@mui/icons-material/BugReport';
import VerifiedIcon from '@mui/icons-material/VerifiedUser';
import GavelIcon from '@mui/icons-material/Gavel';
import { useFindings, type FindingsFilters, type Finding } from '../../api/hooks';
import { WorkStateChip } from '../../components/status';
import { workStateFromFindingStatus, type WorkState } from '../../lib/status';
import { StatusPill } from '../../components/design';
import { useProjectScope } from '../../lib/useProjectScope';

const SOURCES = ['all', 'code_scanner', 'infra_agent', 'cert_monitor', 'cve_scan', 'security_audit', 'brute_force'];

/** Work-state tab → backend `status` query param. */
const WORK_STATE_TO_QUERY: Record<WorkState | 'all', string | undefined> = {
  all: undefined,
  new: 'open',
  'in-progress': 'in_progress',
  resolved: 'resolved',
  dismissed: 'ignored',
};

const WORK_STATE_TABS: Array<{ key: WorkState | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
];

/** Per-source icon + human label, for compact display in the finding card meta row. */
const SOURCE_META: Record<string, { icon: ReactNode; label: string }> = {
  code_scanner:    { icon: <BugReportIcon sx={{ fontSize: 14 }} />, label: 'Code scan' },
  infra_agent:     { icon: <StorageIcon  sx={{ fontSize: 14 }} />, label: 'Infra agent' },
  cert_monitor:    { icon: <LockIcon     sx={{ fontSize: 14 }} />, label: 'Cert monitor' },
  cve_scan:        { icon: <BugReportIcon sx={{ fontSize: 14 }} />, label: 'CVE scan' },
  security_audit:  { icon: <VerifiedIcon sx={{ fontSize: 14 }} />, label: 'Security audit' },
  brute_force:     { icon: <GavelIcon    sx={{ fontSize: 14 }} />, label: 'Brute force' },
};

const SEVERITY_META: Record<string, { icon: ReactNode; color: string }> = {
  critical: { icon: <ErrorOutlineIcon />,        color: '#ef4444' },
  high:     { icon: <ReportProblemIcon />,       color: '#f59e0b' },
  medium:   { icon: <InfoOutlinedIcon />,        color: '#22d3ee' },
  low:      { icon: <RemoveCircleOutlineIcon />, color: '#94a3b8' },
  info:     { icon: <InfoOutlinedIcon />,        color: '#94a3b8' },
};

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Valid URL values for each filter — anything else is treated as "unset".
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_WORK_STATES = new Set<WorkState | 'all'>(['all', 'new', 'in-progress', 'resolved', 'dismissed']);

export function FindingsPage() {
  const { projectId: scopedProjectId } = useProjectScope();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state lives in the URL so dashboard click-throughs (and any deep
  // link) can pre-apply the filter, and so the back button restores it.
  const severity = (() => {
    const v = searchParams.get('severity');
    return v && VALID_SEVERITIES.has(v) ? v : 'all';
  })();
  const source = searchParams.get('source') ?? 'all';
  const workState: WorkState | 'all' = (() => {
    const v = searchParams.get('state');
    return v && VALID_WORK_STATES.has(v as WorkState | 'all') ? (v as WorkState | 'all') : 'new';
  })();
  const search = searchParams.get('q') ?? '';

  // Pagination is purely transient — kept as local state.
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const updateParam = useCallback(
    (key: string, value: string | null, opts: { defaultValue?: string } = {}) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === opts.defaultValue) next.delete(key);
        else next.set(key, value);
        return next;
      }, { replace: false });
      setPage(0);
    },
    [setSearchParams],
  );

  const setSeverity = (sev: string) => updateParam('severity', sev, { defaultValue: 'all' });
  const setSource = (s: string) => updateParam('source', s, { defaultValue: 'all' });
  const setWorkState = (s: WorkState | 'all') => updateParam('state', s, { defaultValue: 'new' });
  const setSearch = (q: string) => updateParam('q', q);

  const filters: FindingsFilters = {
    ...(severity !== 'all' && { severity }),
    ...(WORK_STATE_TO_QUERY[workState] && { status: WORK_STATE_TO_QUERY[workState] }),
    ...(source !== 'all' && { source }),
    ...(scopedProjectId && { projectId: scopedProjectId }),
    page: page + 1,
    limit: rowsPerPage,
  };

  const { data: findings, isLoading } = useFindings(filters);

  // Parallel query for severity distribution within the current work-state filter,
  // not limited by severity — used for the stat cards.
  const { data: severityCountsSource } = useFindings({
    ...(WORK_STATE_TO_QUERY[workState] && { status: WORK_STATE_TO_QUERY[workState] }),
    ...(source !== 'all' && { source }),
    ...(scopedProjectId && { projectId: scopedProjectId }),
    page: 1,
    limit: 500,
  });

  const counts = {
    critical: severityCountsSource?.filter((f) => f.severity === 'critical').length ?? 0,
    high:     severityCountsSource?.filter((f) => f.severity === 'high').length ?? 0,
    medium:   severityCountsSource?.filter((f) => f.severity === 'medium').length ?? 0,
    low:      severityCountsSource?.filter((f) => f.severity === 'low').length ?? 0,
    info:     severityCountsSource?.filter((f) => f.severity === 'info').length ?? 0,
  };

  const toggleSeverity = (sev: string) => {
    setSeverity(severity === sev ? 'all' : sev);
  };

  const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;
  const hasFilters = severity !== 'all' || source !== 'all' || workState !== 'new' || !!search;
  const clearAll = () => {
    // Clear every filter param in a single URL update so we don't churn history.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('severity');
      next.delete('source');
      next.delete('state');
      next.delete('q');
      return next;
    }, { replace: false });
    setPage(0);
  };

  // Apply search client-side over title + cve + asset.
  const visibleFindings = (findings ?? []).filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const asset = f.repository ? `${f.repository.owner}/${f.repository.name}` : f.server?.hostname ?? '';
    return (
      f.title.toLowerCase().includes(q)
      || (f.cveId ?? '').toLowerCase().includes(q)
      || asset.toLowerCase().includes(q)
    );
  });

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4">Findings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Vulnerabilities and misconfigurations across all assets ·{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
              {total} {total === 1 ? 'finding' : 'findings'}
            </Box>
          </Typography>
        </Box>
      </Stack>

      {/* Severity pills + search */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.25, px: 1.75, '&:last-child': { pb: 1.25 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <StatusPill label="All" count={total} active={severity === 'all'} onClick={() => setSeverity('all')} />
              <StatusPill label="Critical" color="#ef4444" count={counts.critical} active={severity === 'critical'} onClick={() => toggleSeverity('critical')} />
              <StatusPill label="High" color="#f59e0b" count={counts.high} active={severity === 'high'} onClick={() => toggleSeverity('high')} />
              <StatusPill label="Medium" color="#22d3ee" count={counts.medium} active={severity === 'medium'} onClick={() => toggleSeverity('medium')} />
              <StatusPill label="Low" color="#94a3b8" count={counts.low} active={severity === 'low'} onClick={() => toggleSeverity('low')} />
            </Stack>

            <Box sx={{ flex: 1 }} />

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                size="small" placeholder="Search title, CVE, or asset" value={search}
                onChange={(e) => setSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <IconButton size="small" onClick={() => setSearch('')}>
                        <ClearIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    ) : null,
                  },
                }}
                sx={{ width: 280 }}
              />
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Source</InputLabel>
                <Select value={source} label="Source" onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => (
                    <MenuItem key={s} value={s}>{formatLabel(s)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {hasFilters && (
                <Button size="small" onClick={clearAll} sx={{ textTransform: 'none', color: 'text.secondary' }}>
                  Clear
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Work-state pills — secondary toggle row */}
      <Stack direction="row" spacing={1} alignItems="center" mb={2} flexWrap="wrap" useFlexGap>
        <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.6, mr: 0.5 }}>
          Work state
        </Typography>
        {WORK_STATE_TABS.map((t) => {
          const isActive = workState === t.key;
          return (
            <Chip
              key={t.key}
              label={t.label}
              size="small"
              color={isActive ? 'primary' : 'default'}
              variant={isActive ? 'filled' : 'outlined'}
              onClick={() => setWorkState(t.key)}
              sx={{ textTransform: 'lowercase', fontWeight: 500 }}
            />
          );
        })}
      </Stack>

      {/* Findings list — one card per finding */}
      {isLoading ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : !visibleFindings.length ? (
        <Card sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary" sx={{ mb: hasFilters ? 1 : 0 }}>
            {hasFilters ? 'No findings match the current filters.' : 'No findings.'}
          </Typography>
          {hasFilters && (
            <Button size="small" onClick={clearAll} sx={{ textTransform: 'none' }}>
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <Stack spacing={1}>
          {visibleFindings.map((f) => (
            <FindingCard key={f.id} finding={f} onClick={() => navigate(`/findings/${f.id}`)} />
          ))}
        </Stack>
      )}

      {/* Pagination — only when there's something to page through */}
      {!isLoading && visibleFindings.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <TablePagination
            component="div"
            count={-1}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 20, 50]}
            labelDisplayedRows={({ from, to }) => `${from}-${to}`}
          />
        </Card>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// FindingCard — single finding rendered as a wide, scannable row card.
// Severity-coloured left edge, severity icon avatar, title on top, asset/source/
// CVE meta on the bottom, work state + CVSS + date stacked on the right.
// ---------------------------------------------------------------------------

function FindingCard({ finding, onClick }: { finding: Finding; onClick: () => void }) {
  const sev = SEVERITY_META[finding.severity] ?? SEVERITY_META.info;
  const src = SOURCE_META[finding.source] ?? { icon: <BugReportIcon sx={{ fontSize: 14 }} />, label: formatLabel(finding.source) };
  const assetLabel = finding.repository
    ? `${finding.repository.owner}/${finding.repository.name}`
    : finding.server?.hostname ?? null;
  const assetIcon = finding.repository ? <GitHubIcon sx={{ fontSize: 14 }} /> : finding.server ? <StorageIcon sx={{ fontSize: 14 }} /> : <DnsIcon sx={{ fontSize: 14 }} />;

  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.15s, transform 0.05s',
        '&:hover': { borderColor: `${sev.color}55`, '& .arrow': { color: 'text.primary', transform: 'translateX(2px)' } },
        '&:active': { transform: 'translateY(1px)' },
        '&::before': {
          content: '""', position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 3, background: sev.color,
        },
      }}
    >
      <CardContent sx={{ py: 1.5, pl: 2.5, pr: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          {/* Severity icon avatar */}
          <Box sx={{
            width: 36, height: 36, borderRadius: 1.5, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${sev.color}1f`, color: sev.color,
            '& svg': { fontSize: 20 },
          }}>
            {sev.icon}
          </Box>

          {/* Center column: title + meta row */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Chip
                label={finding.severity}
                size="small"
                sx={{
                  height: 20, textTransform: 'capitalize', fontWeight: 600, fontSize: 11,
                  bgcolor: `${sev.color}26`, color: sev.color,
                  '& .MuiChip-label': { px: 0.875 },
                }}
              />
              {finding.cveId && (
                <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
                  {finding.cveId}
                </Typography>
              )}
            </Stack>
            <Typography sx={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>
              {finding.title}
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ mt: 0.75, color: 'text.secondary' }} flexWrap="wrap" useFlexGap>
              {assetLabel && (
                <MetaItem icon={assetIcon} text={assetLabel} />
              )}
              <MetaItem icon={src.icon} text={src.label} />
              <MetaItem text={`${timeAgo(finding.createdAt)}`} />
            </Stack>
          </Box>

          {/* Right column: CVSS + work state + chevron */}
          <Stack direction="column" alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              {finding.cvssScore != null && (
                <Box sx={{
                  px: 0.875, py: 0.125, borderRadius: 1, border: '1px solid',
                  borderColor: `${sev.color}55`,
                  fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: sev.color,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  CVSS {finding.cvssScore.toFixed(1)}
                </Box>
              )}
              <WorkStateChip state={workStateFromFindingStatus(finding.status)} />
              <ChevronRightIcon className="arrow" sx={{ fontSize: 18, color: 'text.disabled', transition: 'all 0.15s' }} />
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function MetaItem({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
      {icon && <Box sx={{ display: 'inline-flex', color: 'text.disabled' }}>{icon}</Box>}
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>{text}</Typography>
    </Stack>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
