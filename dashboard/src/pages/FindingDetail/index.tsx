import { Link } from 'react-router-dom';
import { useFinding, useUpdateFinding } from '../../api/hooks.js';

const SEVERITY_COLOR: Record<string, string> = { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#2563eb', info: '#6b7280' };
const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'resolved', 'suppressed', 'false_positive'],
  in_progress: ['resolved', 'suppressed', 'false_positive'],
  resolved: ['open'],
  suppressed: ['open'],
  false_positive: ['open'],
};
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', suppressed: 'Suppressed', false_positive: 'False Positive' };

export function FindingDetail({ findingId }: { findingId: string }) {
  const { data: envelope, isLoading } = useFinding(findingId);
  const updateMutation = useUpdateFinding();
  const finding = envelope?.data as Record<string, unknown> | undefined;

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading finding...</div>;
  if (!finding) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Finding not found</div>;

  const severity = finding.severity as string;
  const status = finding.status as string;
  const transitions = STATUS_TRANSITIONS[status] ?? [];
  const detail = (finding.detail ?? {}) as Record<string, unknown>;

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({ id: findingId, status: newStatus });
  };

  return (
    <div>
      <Link to="/findings" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>← Back to Findings</Link>

      <div style={{ background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ background: SEVERITY_COLOR[severity] ?? '#6b7280', color: '#fff', padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{severity}</span>
              <span style={{ background: '#f3f4f6', padding: '3px 10px', borderRadius: 4, fontSize: 12, color: '#666' }}>{STATUS_LABEL[status]}</span>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{finding.title as string}</h2>
          </div>

          {/* Status actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {transitions.map((s) => (
              <button key={s} onClick={() => handleStatusChange(s)} disabled={updateMutation.isPending}
                style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 12, cursor: 'pointer' }}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <InfoRow label="CVE ID" value={finding.cveId as string} mono />
          <InfoRow label="CVSS Score" value={finding.cvssScore != null ? String(finding.cvssScore) : 'N/A'} />
          <InfoRow label="CVSS Vector" value={(finding.cvssVector as string) ?? 'N/A'} mono />
          <InfoRow label="Source" value={finding.source as string} />
          <InfoRow label="First Seen" value={finding.firstSeenAt ? new Date(finding.firstSeenAt as string).toLocaleString() : 'N/A'} />
          <InfoRow label="Resolved At" value={finding.resolvedAt ? new Date(finding.resolvedAt as string).toLocaleString() : '-'} />
          <InfoRow label="Auto-fixable" value={(finding.autoFixable as boolean) ? 'Yes' : 'No'} />
          {finding.fixPrUrl && <InfoRow label="Fix PR" value={finding.fixPrUrl as string} link />}
        </div>

        {/* Description */}
        {finding.description && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#333' }}>Description</h3>
            <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>{finding.description as string}</p>
          </div>
        )}

        {/* Remediation */}
        {finding.remediation && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: 16, marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#16a34a' }}>Remediation</h3>
            <p style={{ fontSize: 13, color: '#166534', margin: 0 }}>{finding.remediation as string}</p>
          </div>
        )}

        {/* Detail (package info etc) */}
        {Object.keys(detail).length > 0 && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#333' }}>Details</h3>
            <div style={{ background: '#f9fafb', borderRadius: 4, padding: 12, fontSize: 12, fontFamily: 'monospace' }}>
              {Object.entries(detail).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 4 }}><span style={{ color: '#666' }}>{k}:</span> <span style={{ color: '#111' }}>{String(v)}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono, link }: { label: string; value?: string | null; mono?: boolean; link?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      {link && value ? (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#2563eb' }}>{value}</a>
      ) : (
        <div style={{ fontSize: 13, fontFamily: mono ? 'monospace' : 'inherit', color: '#111' }}>{value ?? '-'}</div>
      )}
    </div>
  );
}
