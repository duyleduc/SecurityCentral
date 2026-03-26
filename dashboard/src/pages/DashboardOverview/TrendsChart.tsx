import type { TrendPoint } from '../../api/hooks.js';

interface TrendsData {
  new_findings: TrendPoint[];
  resolved_findings: TrendPoint[];
}

export function TrendsChart({ data, isLoading }: { data?: TrendsData | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ color: '#999', textAlign: 'center' }}>Loading trends...</div>
      </div>
    );
  }

  const newFindings = data?.new_findings ?? [];
  const resolved = data?.resolved_findings ?? [];
  const maxCount = Math.max(1, ...newFindings.map((p) => p.count), ...resolved.map((p) => p.count));

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Findings Trend (30 days)</h3>

      {newFindings.length === 0 ? (
        <div style={{ color: '#999', textAlign: 'center', padding: 20 }}>No data yet</div>
      ) : (
        <div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#dc2626', marginRight: 4, verticalAlign: 'middle' }} /> New</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: '#16a34a', marginRight: 4, verticalAlign: 'middle' }} /> Resolved</span>
          </div>

          {/* Bar chart */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
            {newFindings.map((point, i) => {
              const resolvedPoint = resolved[i];
              const newHeight = (point.count / maxCount) * 100;
              const resHeight = resolvedPoint ? (resolvedPoint.count / maxCount) * 100 : 0;

              return (
                <div key={point.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: 100, gap: 1, width: '100%' }}>
                    <div style={{ flex: 1, height: `${newHeight}%`, background: '#dc2626', borderRadius: '2px 2px 0 0', minHeight: point.count > 0 ? 2 : 0 }} title={`New: ${point.count}`} />
                    <div style={{ flex: 1, height: `${resHeight}%`, background: '#16a34a', borderRadius: '2px 2px 0 0', minHeight: resHeight > 0 ? 2 : 0 }} title={`Resolved: ${resolvedPoint?.count ?? 0}`} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-axis labels (show every ~5th) */}
          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
            {newFindings.map((point, i) => (
              <div key={point.date} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: '#999' }}>
                {i % Math.max(1, Math.floor(newFindings.length / 6)) === 0 ? point.date.slice(5) : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
