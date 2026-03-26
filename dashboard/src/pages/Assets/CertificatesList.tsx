import { useState } from 'react';
import { useCertificates, useCertificate, type Certificate } from '../../api/hooks.js';
import { Pagination } from './RepositoriesList.js';

function expiryColor(notAfter: string): string {
  const days = Math.floor((new Date(notAfter).getTime() - Date.now()) / 86400000);
  if (days <= 0) return '#dc2626';
  if (days <= 30) return '#dc2626';
  if (days <= 90) return '#ca8a04';
  return '#16a34a';
}

function daysUntil(notAfter: string): string {
  const days = Math.floor((new Date(notAfter).getTime() - Date.now()) / 86400000);
  if (days <= 0) return 'Expired';
  return `${days}d`;
}

export function CertificatesList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const params: Record<string, string | number> = { page, per_page: 25 };
  if (statusFilter) params.status = statusFilter;

  const certs = useCertificates(params);
  const data = certs.data?.data as Certificate[] | undefined;
  const meta = certs.data?.meta;

  if (selectedId) return <CertificateDetail id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Certificates</h2>

      <div style={{ marginBottom: 12 }}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      <div style={card}>
        <table style={table}>
          <thead><tr style={theadRow}>
            <th style={th}>Subject</th><th style={th}>Issuer</th><th style={th}>Expires</th><th style={th}>Status</th><th style={th}>Algorithm</th>
          </tr></thead>
          <tbody>
            {certs.isLoading ? <tr><td colSpan={5} style={empty}>Loading...</td></tr>
            : !data?.length ? <tr><td colSpan={5} style={empty}>No certificates</td></tr>
            : data.map((c) => (
              <tr key={c.id} style={row} onClick={() => setSelectedId(c.id)}>
                <td style={{ ...td, fontWeight: 500 }}>{c.subjectCn}</td>
                <td style={{ ...td, color: '#666' }}>{c.issuerCn}</td>
                <td style={td}>
                  <span style={{ color: expiryColor(c.notAfter), fontWeight: 600, fontSize: 12 }}>{daysUntil(c.notAfter)}</span>
                  <span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>{new Date(c.notAfter).toLocaleDateString()}</span>
                </td>
                <td style={td}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: c.status === 'active' ? '#f0fdf4' : c.status === 'expired' ? '#fef2f2' : '#fefce8', color: c.status === 'active' ? '#16a34a' : c.status === 'expired' ? '#dc2626' : '#ca8a04' }}>{c.status}</span></td>
                <td style={{ ...td, fontSize: 12, color: '#666' }}>{c.keyAlgorithm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && <Pagination page={page} total={meta.total ?? 0} perPage={25} onPage={setPage} />}
    </div>
  );
}

function CertificateDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: envelope, isLoading } = useCertificate(id);
  const cert = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) return <div style={empty}>Loading...</div>;
  if (!cert) return <div style={empty}>Not found</div>;

  const sans = (cert.sans ?? []) as string[];
  const findings = (cert.findings ?? []) as Array<Record<string, unknown>>;

  return (
    <div>
      <button onClick={onBack} style={backBtn}>← Back to Certificates</button>
      <div style={card}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{cert.subjectCn as string}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13, marginBottom: 20 }}>
          <div><span style={label}>Issuer:</span> {cert.issuerCn as string}</div>
          <div><span style={label}>Serial:</span> <code style={{ fontSize: 11 }}>{cert.serialNumber as string}</code></div>
          <div><span style={label}>Not Before:</span> {cert.notBefore ? new Date(cert.notBefore as string).toLocaleString() : '-'}</div>
          <div><span style={label}>Not After:</span> <span style={{ color: expiryColor(cert.notAfter as string), fontWeight: 600 }}>{new Date(cert.notAfter as string).toLocaleString()}</span></div>
          <div><span style={label}>Key Algorithm:</span> {cert.keyAlgorithm as string}</div>
          <div><span style={label}>Signature:</span> {(cert.signatureAlgorithm as string) ?? '-'}</div>
          <div><span style={label}>Chain Valid:</span> {cert.chainValid != null ? (cert.chainValid ? '✅ Yes' : '❌ No') : '-'}</div>
          <div><span style={label}>Chain Depth:</span> {cert.chainDepth != null ? String(cert.chainDepth) : '-'}</div>
          <div><span style={label}>Fingerprint:</span> <code style={{ fontSize: 10 }}>{(cert.fingerprintSha256 as string)?.slice(0, 32)}...</code></div>
          <div><span style={label}>Source:</span> {(cert.discoveredFrom as string) ?? '-'}</div>
        </div>

        {/* SANs */}
        {sans.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Subject Alternative Names ({sans.length})</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {sans.map((san) => (
                <span key={san} style={{ fontSize: 12, padding: '2px 8px', background: '#f3f4f6', borderRadius: 4, fontFamily: 'monospace' }}>{san}</span>
              ))}
            </div>
          </div>
        )}

        {/* Related findings */}
        {findings.length > 0 && (
          <>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Related Findings</h4>
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
