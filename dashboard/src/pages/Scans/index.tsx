import { useState } from 'react';
import { useScans, useScan, useCancelScan, type Scan } from '../../api/hooks.js';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending: { bg: '#f3f4f6', color: '#6b7280' },
  running: { bg: '#eff6ff', color: '#2563eb' },
  completed: { bg: '#f0fdf4', color: '#16a34a' },
  failed: { bg: '#fef2f2', color: '#dc2626' },
  cancelled: { bg: '#f5f5f5', color: '#6b7280' },
};

const TYPE_ICON: Record<string, string> = {
  code_dependencies: '📦', code_secrets: '🔑', infra_packages: '🖥️', infra_compliance: '📋', cert_discovery: '🔒', cert_check: '🔒',
};

export function ScansPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const params: Record<string, string | number> = { page, per_page: 25 };
  if (statusFilter) params.status = statusFilter;

  const scans = useScans(params);
  const data = scans.data?.data as Scan[] | undefined;
  const meta = scans.data?.meta;

  if (selectedId) return <ScanDetail scanId={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Scans</h2>

      <div style={{ marginBottom: 12 }}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}>
          <option value="">All Statuses</option>
          {['pending', 'running', 'completed', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={card}>
        <table style={table}>
          <thead><tr style={theadRow}>
            <th style={th}>Type</th><th style={th}>Status</th><th style={th}>Trigger</th><th style={th}>Started</th><th style={th}>Duration</th>
            <th style={{ ...th, textAlign: 'right' }}>Total</th><th style={{ ...th, textAlign: 'right' }}>New</th><th style={{ ...th, textAlign: 'right' }}>Resolved</th>
          </tr></thead>
          <tbody>
            {scans.isLoading ? <tr><td colSpan={8} style={empty}>Loading...</td></tr>
            : !data?.length ? <tr><td colSpan={8} style={empty}>No scans</td></tr>
            : data.map((s) => {
              const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.pending;
              return (
                <tr key={s.id} style={row} onClick={() => setSelectedId(s.id)}>
                  <td style={td}>{TYPE_ICON[s.scanType] ?? '⚡'} {s.scanType}</td>
                  <td style={td}>
                    <span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{s.status}</span>
                    {s.status === 'running' && <span style={{ marginLeft: 6, fontSize: 11 }}>⏳</span>}
                  </td>
                  <td style={{ ...td, color: '#666' }}>{s.trigger}</td>
                  <td style={{ ...td, fontSize: 12, color: '#666' }}>{s.startedAt ? new Date(s.startedAt).toLocaleString() : '-'}</td>
                  <td style={{ ...td, fontSize: 12, color: '#666' }}>{s.completedAt && s.startedAt ? `${Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)}s` : '-'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{s.findingsTotal}</td>
                  <td style={{ ...td, textAlign: 'right', color: s.findingsNew > 0 ? '#dc2626' : '#666' }}>{s.findingsNew}</td>
                  <td style={{ ...td, textAlign: 'right', color: s.findingsResolved > 0 ? '#16a34a' : '#666' }}>{s.findingsResolved}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {meta && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13, color: '#666' }}>
          <span>Page {meta.page} of {Math.ceil((meta.total ?? 0) / 25)}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={btn(page <= 1)}>Previous</button>
            <button disabled={page * 25 >= (meta.total ?? 0)} onClick={() => setPage(page + 1)} style={btn(false)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanDetail({ scanId, onBack }: { scanId: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useScan(scanId);
  const cancelScan = useCancelScan();
  const scan = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) return <div style={empty}>Loading...</div>;
  if (!scan) return <div style={empty}>Not found</div>;

  const status = scan.status as string;
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  const canCancel = status === 'pending' || status === 'running';

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer', marginBottom: 16, padding: 0 }}>← Back to Scans</button>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <span style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{status}</span>
            {status === 'running' && <span style={{ marginLeft: 8 }}>⏳ In progress...</span>}
            <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>{scan.scanType as string}</h3>
          </div>
          {canCancel && (
            <button onClick={() => cancelScan.mutate(scanId)} disabled={cancelScan.isPending}
              style={{ padding: '6px 16px', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 4, background: '#fff', fontSize: 13, cursor: 'pointer' }}>
              {cancelScan.isPending ? 'Cancelling...' : 'Cancel Scan'}
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13, marginBottom: 20 }}>
          <div><span style={label}>Trigger:</span> {scan.trigger as string}</div>
          <div><span style={label}>Started:</span> {scan.startedAt ? new Date(scan.startedAt as string).toLocaleString() : '-'}</div>
          <div><span style={label}>Completed:</span> {scan.completedAt ? new Date(scan.completedAt as string).toLocaleString() : '-'}</div>
        </div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          <StatBox label="Total" value={scan.findingsTotal as number} />
          <StatBox label="New" value={scan.findingsNew as number} color="#dc2626" />
          <StatBox label="Resolved" value={scan.findingsResolved as number} color="#16a34a" />
        </div>

        {scan.errorMessage && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12, color: '#dc2626', fontSize: 13 }}>
            <strong>Error:</strong> {scan.errorMessage as string}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 6, padding: 16, textAlign: 'center', minWidth: 80 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? '#111' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const theadRow: React.CSSProperties = { borderBottom: '2px solid #e5e7eb', background: '#f9fafb' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '10px 12px' };
const row: React.CSSProperties = { borderBottom: '1px solid #f3f4f6', cursor: 'pointer' };
const empty: React.CSSProperties = { padding: 40, textAlign: 'center', color: '#999' };
const label: React.CSSProperties = { color: '#999', fontSize: 11, textTransform: 'uppercase', display: 'block', marginBottom: 2 };
const btn = (disabled: boolean): React.CSSProperties => ({ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 });
