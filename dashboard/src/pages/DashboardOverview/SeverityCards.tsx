interface SeverityData {
  total: number;
  by_severity: Record<string, number>;
  open: number;
  resolved: number;
}

const SEVERITY_CONFIG = [
  { key: 'critical', label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
  { key: 'high', label: 'High', color: '#ea580c', bg: '#fff7ed' },
  { key: 'medium', label: 'Medium', color: '#ca8a04', bg: '#fefce8' },
  { key: 'low', label: 'Low', color: '#2563eb', bg: '#eff6ff' },
] as const;

export function SeverityCards({ data, isLoading }: { data?: SeverityData | null; isLoading: boolean }) {
  if (isLoading) {
    return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ height: 90, borderRadius: 8, background: '#e5e7eb', animation: 'pulse 1.5s infinite' }} />
      ))}
    </div>;
  }

  const bySeverity = data?.by_severity ?? {};

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {SEVERITY_CONFIG.map(({ key, label, color, bg }) => (
          <div key={key} style={{ background: bg, borderRadius: 8, padding: 16, borderLeft: `4px solid ${color}` }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{bySeverity[key] ?? 0}</div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 13, color: '#666' }}>
        <span>Total: <strong>{data?.total ?? 0}</strong></span>
        <span>Open: <strong>{data?.open ?? 0}</strong></span>
        <span>Resolved: <strong>{data?.resolved ?? 0}</strong></span>
      </div>
    </div>
  );
}
