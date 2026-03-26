import { useState } from 'react';
import { useServers, useServer, type Server } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';

const ENV_COLOR: Record<string, string> = { production: '#dc2626', staging: '#ca8a04', development: '#2563eb' };
const STATUS_DOT: Record<string, string> = { active: '#16a34a', inactive: '#dc2626', decommissioned: '#6b7280' };

function relativeTime(dateStr?: string): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ServersList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const servers = useServers({ page, per_page: 25 });
  const data = servers.data?.data as (Server & { openFindingCount?: number })[] | undefined;
  const meta = servers.data?.meta;

  if (selectedId) return <ServerDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Servers</h2>
      <div style={card}>
        <table style={table}>
          <thead><tr style={theadRow}>
            <th style={th}>Status</th><th style={th}>Hostname</th><th style={th}>OS</th><th style={th}>Environment</th><th style={th}>Last Heartbeat</th><th style={{ ...th, textAlign: 'right' }}>Findings</th>
          </tr></thead>
          <tbody>
            {servers.isLoading ? <tr><td colSpan={6} style={empty}>Loading...</td></tr>
            : !data?.length ? <tr><td colSpan={6} style={empty}>No servers</td></tr>
            : data.map((s) => (
              <tr key={s.id} style={row} onClick={() => setSelectedId(s.id)}>
                <td style={td}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[s.status] ?? '#6b7280' }} /></td>
                <td style={{ ...td, fontWeight: 500 }}>{s.hostname}</td>
                <td style={{ ...td, color: '#666' }}>{s.osFamily} {s.osVersion}</td>
                <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, color: '#fff', background: ENV_COLOR[s.environment] ?? '#6b7280' }}>{s.environment}</span></td>
                <td style={{ ...td, fontSize: 12, color: '#666' }}>{relativeTime(s.lastHeartbeat)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>{s.openFindingCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </div>
  );
}

function ServerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useServer(id);
  const server = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) return <div style={empty}>Loading...</div>;
  if (!server) return <div style={empty}>Not found</div>;

  const findings = (server.recentFindings ?? []) as Array<Record<string, unknown>>;
  const counts = (server.findingCounts ?? {}) as Record<string, number>;

  return (
    <div>
      <button onClick={onBack} style={backBtn}>← Back to Servers</button>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: STATUS_DOT[server.status as string] ?? '#6b7280' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{server.hostname as string}</h3>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, color: '#fff', background: ENV_COLOR[server.environment as string] ?? '#6b7280' }}>{server.environment as string}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13, marginBottom: 20 }}>
          <div><span style={label}>OS:</span> {server.osFamily as string} {server.osVersion as string}</div>
          <div><span style={label}>Arch:</span> {server.arch as string}</div>
          <div><span style={label}>Agent:</span> {(server.agentVersion as string) ?? '-'}</div>
          <div><span style={label}>Cloud:</span> {(server.cloudProvider as string) ?? 'On-prem'}</div>
          <div><span style={label}>Region:</span> {(server.cloudRegion as string) ?? '-'}</div>
          <div><span style={label}>Heartbeat:</span> {relativeTime(server.lastHeartbeat as string)}</div>
        </div>

        {Object.keys(counts).length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {Object.entries(counts).map(([sev, count]) => (
              <span key={sev} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: sev === 'critical' ? '#dc2626' : sev === 'high' ? '#ea580c' : '#ca8a04', color: '#fff' }}>{sev}: {count}</span>
            ))}
          </div>
        )}

        {findings.length > 0 && (
          <>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Recent Findings</h4>
            {findings.map((f) => (
              <div key={f.id as string} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>{f.title as string}</span> <span style={{ color: '#666', fontSize: 12 }}>({f.severity as string})</span>
              </div>
            ))}
          </>
        )}
      </div>
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
const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer', marginBottom: 16, padding: 0 };
const label: React.CSSProperties = { color: '#999', fontSize: 11, textTransform: 'uppercase', display: 'block', marginBottom: 2 };
