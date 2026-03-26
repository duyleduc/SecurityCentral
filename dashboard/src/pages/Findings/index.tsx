import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFindings, type Finding } from '../../api/hooks.js';
import { FindingDetail } from '../FindingDetail/index.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'suppressed', 'false_positive'] as const;
const SOURCES = ['code_scanner', 'infra_agent', 'cert_monitor'] as const;

const SEVERITY_BADGE: Record<string, { bg: string; color: string }> = {
  critical: { bg: '#dc2626', color: '#fff' },
  high: { bg: '#ea580c', color: '#fff' },
  medium: { bg: '#ca8a04', color: '#fff' },
  low: { bg: '#2563eb', color: '#fff' },
  info: { bg: '#6b7280', color: '#fff' },
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  suppressed: 'Suppressed',
  false_positive: 'False Positive',
};

export function FindingsPage() {
  const { id } = useParams<{ id?: string }>();

  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const params: Record<string, string | number> = { page, per_page: perPage, sort, order };
  if (severity) params.severity = severity;
  if (status) params.status = status;
  if (source) params.source = source;
  if (q) params.q = q;

  const findings = useFindings(params);
  const data = findings.data?.data as Finding[] | undefined;
  const meta = findings.data?.meta;

  const toggleSort = useCallback((col: string) => {
    if (sort === col) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setOrder('desc'); }
  }, [sort]);

  if (id) return <FindingDetail findingId={id} />;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Findings</h2>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search CVE or title..." value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, width: 220 }} />
        <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
          style={selectStyle}><option value="">All Severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          style={selectStyle}><option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}
          style={selectStyle}><option value="">All Sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(severity || status || source || q) && (
          <button onClick={() => { setSeverity(''); setStatus(''); setSource(''); setQ(''); setPage(1); }}
            style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>Clear filters</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <SortTh label="Severity" col="severity" cur={sort} ord={order} onSort={toggleSort} />
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>CVE</th>
              <th style={thStyle}>Status</th>
              <SortTh label="First Seen" col="first_seen_at" cur={sort} ord={order} onSort={toggleSort} />
              <SortTh label="CVSS" col="cvss_score" cur={sort} ord={order} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {findings.isLoading ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading...</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#999' }}>No findings match your filters</td></tr>
            ) : data.map((f) => {
              const badge = SEVERITY_BADGE[f.severity] ?? SEVERITY_BADGE.info;
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}><span style={{ background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{f.severity}</span></td>
                  <td style={tdStyle}><Link to={`/findings/${f.id}`} style={{ color: '#111', textDecoration: 'none' }}>{f.title.length > 55 ? f.title.slice(0, 52) + '...' : f.title}</Link></td>
                  <td style={{ ...tdStyle, color: '#666' }}>{f.source}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{f.cveId ?? '-'}</td>
                  <td style={tdStyle}><StatusBadge status={f.status} /></td>
                  <td style={{ ...tdStyle, color: '#666', fontSize: 12 }}>{new Date(f.firstSeenAt).toLocaleDateString()}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{f.cvssScore ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13, color: '#666' }}>
          <span>Page {meta.page} of {Math.ceil((meta.total ?? 0) / (meta.per_page ?? 25))}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={btnStyle(page <= 1)}>Previous</button>
            <button disabled={page * perPage >= (meta.total ?? 0)} onClick={() => setPage((p) => p + 1)} style={btnStyle(false)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = { padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const tdStyle: React.CSSProperties = { padding: '10px 12px' };
const btnStyle = (disabled: boolean): React.CSSProperties => ({ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 });

function SortTh({ label, col, cur, ord, onSort }: { label: string; col: string; cur: string; ord: string; onSort: (c: string) => void }) {
  return <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(col)}>{label} {cur === col ? (ord === 'asc' ? '↑' : '↓') : ''}</th>;
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, { bg: string; color: string }> = { open: { bg: '#fef2f2', color: '#dc2626' }, in_progress: { bg: '#fffbeb', color: '#ca8a04' }, resolved: { bg: '#f0fdf4', color: '#16a34a' }, suppressed: { bg: '#f5f5f5', color: '#6b7280' }, false_positive: { bg: '#f5f5f5', color: '#6b7280' } };
  const s = c[status] ?? c.open;
  return <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>{STATUS_LABEL[status] ?? status}</span>;
}
