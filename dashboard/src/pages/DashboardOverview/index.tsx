import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboardSummary, useDashboardTopRisks, useDashboardAssets, useFindingsTrends } from '../../api/hooks.js';
import { subscribe } from '../../ws/index.js';
import { SeverityCards } from './SeverityCards.js';
import { TopRisksTable } from './TopRisksTable.js';
import { AssetsOverviewCards } from './AssetsOverviewCards.js';
import { TrendsChart } from './TrendsChart.js';

export function DashboardOverview() {
  const summary = useDashboardSummary();
  const topRisks = useDashboardTopRisks();
  const assets = useDashboardAssets();
  const trends = useFindingsTrends({ interval: 'day', days: 30 });
  const qc = useQueryClient();

  // T-12.3.5: WebSocket — refresh on real-time events
  useEffect(() => {
    const unsubs = [
      subscribe('finding:new', () => {
        qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
        qc.invalidateQueries({ queryKey: ['dashboard', 'top-risks'] });
      }),
      subscribe('finding:resolved', () => {
        qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
      }),
      subscribe('scan:completed', () => {
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['findings', 'trends'] });
      }),
      subscribe('agent:disconnected', () => {
        qc.invalidateQueries({ queryKey: ['dashboard', 'assets'] });
      }),
      subscribe('cert:expiring', () => {
        qc.invalidateQueries({ queryKey: ['dashboard', 'assets'] });
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Dashboard</h2>

      {/* Severity Breakdown */}
      <SeverityCards
        data={summary.data?.data?.findings}
        isLoading={summary.isLoading}
      />

      {/* Assets Overview + Trends side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
        <AssetsOverviewCards
          data={assets.data?.data}
          isLoading={assets.isLoading}
        />
        <TrendsChart
          data={trends.data?.data}
          isLoading={trends.isLoading}
        />
      </div>

      {/* Top Risks */}
      <div style={{ marginTop: 20 }}>
        <TopRisksTable
          data={topRisks.data?.data}
          isLoading={topRisks.isLoading}
        />
      </div>
    </div>
  );
}
