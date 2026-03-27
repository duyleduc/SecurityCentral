import { useState } from 'react';
import { useMonitoredEndpoints, useAddEndpoints, useRemoveEndpoint, useTriggerEndpointCheck, type MonitoredEndpoint } from '../../api/hooks.js';

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  healthy: { color: '#16a34a', bg: '#f0fdf4', label: 'Healthy' },
  unhealthy: { color: '#dc2626', bg: '#fef2f2', label: 'Unhealthy' },
  unreachable: { color: '#dc2626', bg: '#fef2f2', label: 'Unreachable' },
};

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DomainMonitoringPage() {
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);

  const endpoints = useMonitoredEndpoints({ page, per_page: 50 });
  const data = (endpoints.data?.data ?? []) as MonitoredEndpoint[];
  const meta = endpoints.data?.meta;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Domain Monitoring</h2>
          <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Monitor TLS certificates and endpoint reachability</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          + Add Domains
        </button>
      </div>

      {showAdd && <AddDomainsForm onDone={() => setShowAdd(false)} />}

      {/* Endpoint list */}
      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        {endpoints.isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading endpoints...</div>
        ) : data.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No domains monitored</h3>
            <p style={{ fontSize: 13 }}>Add domains to start monitoring their TLS certificates</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                <th style={th}>Status</th>
                <th style={th}>Endpoint</th>
                <th style={th}>Last Checked</th>
                <th style={{ ...th, textAlign: 'right' }}>Response</th>
                <th style={th}>Interval</th>
                <th style={{ ...th, width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.map((ep) => (
                <EndpointRow key={ep.id} endpoint={ep} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {meta && meta.total > 50 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13, color: '#666' }}>
          <span>Page {meta.page} of {Math.ceil(meta.total / 50)}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pgBtn(page <= 1)}>Previous</button>
            <button disabled={page * 50 >= meta.total} onClick={() => setPage(page + 1)} style={pgBtn(false)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Domains Form
// ---------------------------------------------------------------------------

function AddDomainsForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [bulkText, setBulkText] = useState('');
  const [interval, setInterval] = useState('1h');
  const addMutation = useAddEndpoints();
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);

  const handleSubmit = async () => {
    setResult(null);
    let endpoints: Array<{ host: string; port: number }>;

    if (mode === 'single') {
      endpoints = [{ host: host.trim(), port: parseInt(port, 10) || 443 }];
    } else {
      endpoints = bulkText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [h, p] = line.split(':');
          return { host: h.trim(), port: parseInt(p, 10) || 443 };
        });
    }

    if (endpoints.length === 0) return;

    try {
      const res = await addMutation.mutateAsync({ endpoints, checkInterval: interval });
      setResult(res.data as { created: number; errors: string[] });
      if ((res.data as any)?.created > 0) {
        setHost('');
        setPort('443');
        setBulkText('');
      }
    } catch (err) {
      setResult({ created: 0, errors: [(err as Error).message] });
    }
  };

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setMode('single')} style={{ ...tabBtn, ...(mode === 'single' ? tabActive : {}) }}>Single</button>
        <button onClick={() => setMode('bulk')} style={{ ...tabBtn, ...(mode === 'bulk' ? tabActive : {}) }}>Bulk</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#666' }}>Check every:</label>
          <select value={interval} onChange={(e) => setInterval(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
            <option value="24h">24 hours</option>
          </select>
        </div>
      </div>

      {mode === 'single' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }} />
          <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="443" style={{ width: 70, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }} />
        </div>
      ) : (
        <div>
          <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={5} placeholder="example.com&#10;api.example.com:443&#10;internal.corp.net:8443"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }} />
          <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>One endpoint per line. Format: host or host:port (default 443)</p>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12, fontSize: 12, padding: 8, borderRadius: 4, background: result.errors.length ? '#fffbeb' : '#f0fdf4', border: `1px solid ${result.errors.length ? '#fde68a' : '#bbf7d0'}` }}>
          {result.created > 0 && <span style={{ color: '#16a34a' }}>{result.created} endpoint(s) added. </span>}
          {result.errors.map((e, i) => <div key={i} style={{ color: '#ca8a04' }}>{e}</div>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button onClick={onDone} style={{ padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSubmit} disabled={addMutation.isPending || (mode === 'single' ? !host.trim() : !bulkText.trim())}
          style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {addMutation.isPending ? 'Adding...' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Endpoint Row
// ---------------------------------------------------------------------------

function EndpointRow({ endpoint: ep }: { endpoint: MonitoredEndpoint }) {
  const removeMutation = useRemoveEndpoint();
  const checkMutation = useTriggerEndpointCheck();

  const status = STATUS_CONFIG[ep.lastStatus ?? ''] ?? { color: '#999', bg: '#f3f4f6', label: ep.lastStatus ?? 'Pending' };

  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={td}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: status.color }} />
      </td>
      <td style={td}>
        <span style={{ fontWeight: 500 }}>{ep.host}</span>
        {ep.port !== 443 && <span style={{ color: '#999', fontSize: 12 }}>:{ep.port}</span>}
        {ep.label && <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>({ep.label})</span>}
      </td>
      <td style={{ ...td, color: '#666', fontSize: 12 }}>{relativeTime(ep.lastCheckedAt)}</td>
      <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
        {ep.lastResponseMs != null ? `${ep.lastResponseMs}ms` : '—'}
      </td>
      <td style={{ ...td, fontSize: 12, color: '#666' }}>{ep.checkInterval}</td>
      <td style={{ ...td, textAlign: 'right' }}>
        <button onClick={() => checkMutation.mutate(ep.id)} disabled={checkMutation.isPending}
          style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: 'none', borderRadius: 4, cursor: 'pointer', marginRight: 6 }}>
          {checkMutation.isPending ? '...' : 'Check Now'}
        </button>
        <button onClick={() => { if (confirm(`Remove ${ep.host}?`)) removeMutation.mutate(ep.id); }}
          style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
          Remove
        </button>
      </td>
    </tr>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '10px 12px' };
const pgBtn = (disabled: boolean): React.CSSProperties => ({ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 13, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 });
const tabBtn: React.CSSProperties = { padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 12, cursor: 'pointer' };
const tabActive: React.CSSProperties = { background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
