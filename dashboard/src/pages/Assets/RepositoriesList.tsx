import { useState } from 'react';
import { useRepositories, useRepository, useTriggerScan, type Repository } from '../../api/hooks.js';

const PROVIDER_ICON: Record<string, string> = { github: '🐙', gitlab: '🦊', bitbucket: '🪣' };

export function RepositoriesList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const repos = useRepositories({ page, per_page: 25 });
  const data = repos.data?.data as Repository[] | undefined;
  const meta = repos.data?.meta;

  if (selectedId) return <RepositoryDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div>
      <h2 style={h2}>Repositories</h2>
      <div style={card}>
        <table style={table}>
          <thead><tr style={theadRow}>
            <th style={th}>Repository</th><th style={th}>Provider</th><th style={th}>Language</th><th style={th}>Last Scan</th>
          </tr></thead>
          <tbody>
            {repos.isLoading ? <tr><td colSpan={4} style={emptyTd}>Loading...</td></tr>
            : !data?.length ? <tr><td colSpan={4} style={emptyTd}>No repositories</td></tr>
            : data.map((r) => (
              <tr key={r.id} style={row} onClick={() => setSelectedId(r.id)}>
                <td style={td}><span style={{ fontWeight: 500 }}>{r.owner}/{r.name}</span></td>
                <td style={td}>{PROVIDER_ICON[r.provider] ?? '📦'} {r.provider}</td>
                <td style={{ ...td, color: '#666' }}>{r.language ?? '-'}</td>
                <td style={{ ...td, fontSize: 12, color: '#666' }}>{r.lastScanAt ? new Date(r.lastScanAt).toLocaleString() : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </div>
  );
}

function RepositoryDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useRepository(id);
  const triggerScan = useTriggerScan();
  const repo = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) return <div style={emptyTd}>Loading...</div>;
  if (!repo) return <div style={emptyTd}>Not found</div>;

  const latestScan = repo.latestScan as Record<string, unknown> | null;
  const findingCounts = (repo.findingCounts ?? {}) as Record<string, number>;

  return (
    <div>
      <button onClick={onBack} style={backBtn}>← Back to Repositories</button>
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{repo.owner as string}/{repo.name as string}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13, marginBottom: 16 }}>
          <div><span style={label}>Provider:</span> {repo.provider as string}</div>
          <div><span style={label}>Branch:</span> {repo.defaultBranch as string}</div>
          <div><span style={label}>Language:</span> {(repo.language as string) ?? '-'}</div>
        </div>

        {/* Finding counts */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {Object.entries(findingCounts).map(([sev, count]) => (
            <span key={sev} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: sevBg(sev), color: '#fff' }}>{sev}: {count}</span>
          ))}
        </div>

        {/* Latest scan */}
        {latestScan && (
          <div style={{ background: '#f9fafb', borderRadius: 4, padding: 12, fontSize: 13, marginBottom: 16 }}>
            <strong>Latest scan:</strong> {latestScan.scanType as string} — {latestScan.status as string}
            {latestScan.completedAt && <span style={{ color: '#666' }}> ({new Date(latestScan.completedAt as string).toLocaleString()})</span>}
          </div>
        )}

        <button onClick={() => triggerScan.mutate(id)} disabled={triggerScan.isPending}
          style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {triggerScan.isPending ? 'Triggering...' : 'Trigger Scan'}
        </button>
        {triggerScan.isError && <span style={{ color: '#dc2626', fontSize: 12, marginLeft: 8 }}>{(triggerScan.error as Error).message}</span>}
      </div>
    </div>
  );
}

// Shared styles/helpers
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 600, marginBottom: 16 };
const card: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const theadRow: React.CSSProperties = { borderBottom: '2px solid #e5e7eb', background: '#f9fafb' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '10px 12px' };
const row: React.CSSProperties = { borderBottom: '1px solid #f3f4f6', cursor: 'pointer' };
const emptyTd: React.CSSProperties = { padding: 40, textAlign: 'center', color: '#999' };
const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer', marginBottom: 16, padding: 0 };
const label: React.CSSProperties = { color: '#999', fontSize: 11, textTransform: 'uppercase' };
function sevBg(s: string) { return s === 'critical' ? '#dc2626' : s === 'high' ? '#ea580c' : s === 'medium' ? '#ca8a04' : '#2563eb'; }

function Pagination({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / perPage);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13, color: '#666' }}>
      <span>Page {page} of {totalPages}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>Previous</button>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>Next</button>
      </div>
    </div>
  );
}

export { Pagination };
