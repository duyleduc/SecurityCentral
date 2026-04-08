import { Link } from 'react-router-dom';
import type { TopRisk } from '../../api/hooks.js';

const SEVERITY_BADGE: Record<string, { bg: string; color: string }> = {
  critical: { bg: '#dc2626', color: '#fff' },
  high: { bg: '#ea580c', color: '#fff' },
  medium: { bg: '#ca8a04', color: '#fff' },
  low: { bg: '#2563eb', color: '#fff' },
  info: { bg: '#6b7280', color: '#fff' },
};

export function TopRisksTable({ data, isLoading }: { data?: TopRisk[] | null; isLoading: boolean }) {
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Top Risks</h3>

      {isLoading ? (
        <div style={{ color: '#999', padding: 20, textAlign: 'center' }}>Loading...</div>
      ) : !data?.length ? (
        <div style={{ color: '#999', padding: 20, textAlign: 'center' }}>No open findings</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 500 }}>Severity</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 500 }}>Title</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 500 }}>Asset</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#666', fontWeight: 500 }}>CVE</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#666', fontWeight: 500 }}>CVSS</th>
            </tr>
          </thead>
          <tbody>
            {data.map((finding) => {
              const badge = SEVERITY_BADGE[finding.severity] ?? SEVERITY_BADGE.info;
              const asset = finding.repository?.name ?? finding.server?.hostname ?? finding.certificate?.subjectCn ?? '-';

              return (
                <tr key={finding.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                      {finding.severity}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <Link to={`/findings/${finding.id}`} style={{ color: '#111', textDecoration: 'none' }}>
                      {finding.title.length > 60 ? finding.title.slice(0, 57) + '...' : finding.title}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#666' }}>{asset}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{finding.cveId ?? '-'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{finding.cvssScore ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
