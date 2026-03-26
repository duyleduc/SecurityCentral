import type { AssetsOverview } from '../../api/hooks.js';

interface AssetCategory {
  label: string;
  icon: string;
  total: number;
  affected: number;
  health_pct: number;
}

function healthColor(pct: number): string {
  if (pct >= 90) return '#16a34a';
  if (pct >= 70) return '#ca8a04';
  return '#dc2626';
}

export function AssetsOverviewCards({ data, isLoading }: { data?: AssetsOverview | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ color: '#999', textAlign: 'center' }}>Loading assets...</div>
      </div>
    );
  }

  const categories: AssetCategory[] = [
    { label: 'Repositories', icon: '📦', ...(data?.repositories ?? { total: 0, affected: 0, health_pct: 100 }) },
    { label: 'Servers', icon: '🖥️', ...(data?.servers ?? { total: 0, affected: 0, health_pct: 100 }) },
    { label: 'Certificates', icon: '🔒', ...(data?.certificates ?? { total: 0, affected: 0, health_pct: 100 }) },
  ];

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Assets Overview</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {categories.map((cat) => (
          <div key={cat.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>{cat.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{cat.label}</span>
                <span style={{ fontSize: 12, color: '#666' }}>{cat.total} total, {cat.affected} affected</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${cat.health_pct}%`, background: healthColor(cat.health_pct), borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: 11, color: healthColor(cat.health_pct), marginTop: 2, fontWeight: 600 }}>
                {cat.health_pct}% healthy
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
