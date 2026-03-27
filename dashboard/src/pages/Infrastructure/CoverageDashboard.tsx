import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCoverageStats, useUnmonitoredServers, useTriggerDiscovery, type CloudResource, type CoverageStats } from '../../api/hooks.js';

const PROVIDER_ICON: Record<string, string> = { aws: '🟧', azure: '🔵', gcp: '🔴', proxmox: '🟩' };
const PROVIDER_LABEL: Record<string, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', proxmox: 'Proxmox' };

function coverageColor(pct: number): string {
  if (pct >= 90) return '#16a34a';
  if (pct >= 70) return '#ca8a04';
  return '#dc2626';
}

export function InfrastructureCoveragePage() {
  const stats = useCoverageStats();
  const unmonitored = useUnmonitoredServers();
  const triggerDiscovery = useTriggerDiscovery();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const coverageData = stats.data?.data as CoverageStats | undefined;
  const unmonitoredData = (unmonitored.data?.data ?? []) as CloudResource[];

  const copyInstallCmd = (resource: CloudResource) => {
    const cmd = `curl -fsSL https://install.securitycentral.io | bash -s -- --api-key YOUR_API_KEY --environment production`;
    navigator.clipboard.writeText(cmd);
    setCopiedId(resource.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Infrastructure Coverage</h2>
        <Link to="/integrations" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>+ Connect Cloud Account</Link>
      </div>

      {/* Overall coverage bar */}
      {coverageData && (
        <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Overall Coverage</span>
            <span style={{ fontSize: 28, fontWeight: 700, color: coverageColor(coverageData.overall_coverage_pct) }}>
              {coverageData.overall_coverage_pct}%
            </span>
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${coverageData.overall_coverage_pct}%`, background: coverageColor(coverageData.overall_coverage_pct), borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
            {coverageData.total_monitored} of {coverageData.total_instances} instances have agents installed
          </div>
        </div>
      )}

      {/* Provider/region breakdown */}
      {coverageData && coverageData.breakdown.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>By Provider & Region</h3>
            <button onClick={() => triggerDiscovery.mutate('aws')} disabled={triggerDiscovery.isPending}
              style={{ fontSize: 12, color: '#2563eb', background: 'none', border: '1px solid #2563eb', borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}>
              {triggerDiscovery.isPending ? 'Refreshing...' : 'Refresh All'}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                <th style={th}>Provider</th>
                <th style={th}>Region</th>
                <th style={{ ...th, textAlign: 'right' }}>Instances</th>
                <th style={{ ...th, textAlign: 'right' }}>Agents</th>
                <th style={{ ...th, textAlign: 'right' }}>Coverage</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {coverageData.breakdown.map((row) => (
                <tr key={`${row.provider}:${row.region}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}>{PROVIDER_ICON[row.provider] ?? '☁️'} {PROVIDER_LABEL[row.provider] ?? row.provider}</td>
                  <td style={{ ...td, color: '#666' }}>{row.region}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{row.total}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{row.monitored}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <span style={{ color: coverageColor(row.coverage_pct), fontWeight: 600 }}>{row.coverage_pct}%</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, width: 80, display: 'inline-block' }}>
                      <div style={{ height: '100%', width: `${row.coverage_pct}%`, background: coverageColor(row.coverage_pct), borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {stats.isLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading coverage data...</div>
      ) : coverageData && coverageData.total_instances === 0 && (
        <div style={{ background: '#fff', borderRadius: 8, padding: 40, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>☁️</div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No cloud accounts connected</h3>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Connect AWS, Azure, or GCP to discover your infrastructure</p>
          <Link to="/integrations" style={{ display: 'inline-block', padding: '8px 20px', background: '#2563eb', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            Connect Cloud Account
          </Link>
        </div>
      )}

      {/* Unmonitored servers */}
      {unmonitoredData.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Unmonitored Servers <span style={{ color: '#dc2626', fontWeight: 400, fontSize: 13 }}>({unmonitoredData.length})</span>
          </h3>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>These instances are running but don't have the SecurityCentral agent installed.</p>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                <th style={th}>Instance</th>
                <th style={th}>Hostname</th>
                <th style={th}>Provider</th>
                <th style={th}>Region</th>
                <th style={th}>IP</th>
                <th style={{ ...th, width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {unmonitoredData.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.resourceId}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{r.hostname ?? '—'}</td>
                  <td style={td}>{PROVIDER_ICON[r.provider] ?? '☁️'} {r.provider.toUpperCase()}</td>
                  <td style={{ ...td, color: '#666' }}>{r.region ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.ipAddress ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => copyInstallCmd(r)}
                      style={{ fontSize: 11, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      {copiedId === r.id ? '✓ Copied' : 'Install Agent'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '10px 12px' };
