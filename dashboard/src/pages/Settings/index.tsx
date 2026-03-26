import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.js';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
}

interface NotifPref {
  id: string;
  channel: string;
  eventType: string;
  enabled: boolean;
}

const SCOPES = ['scan:write', 'findings:read', 'findings:write', 'assets:read', 'assets:write'] as const;
const EVENT_TYPES = ['critical_finding', 'scan_complete', 'cert_expiry', 'agent_offline'] as const;
const EVENT_LABELS: Record<string, string> = { critical_finding: 'Critical Finding', scan_complete: 'Scan Complete', cert_expiry: 'Certificate Expiry', agent_offline: 'Agent Offline' };

export function SettingsPage() {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Settings</h2>
      <OrgInfo />
      <ApiKeysSection />
      <NotificationPrefsSection />
    </div>
  );
}

// --- T-12.8.1: Org Info ---

function OrgInfo() {
  const { user } = useAuth();
  return (
    <div style={card}>
      <h3 style={sectionTitle}>Organization</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
        <div><span style={label}>Role:</span> {user?.role ?? '-'}</div>
        <div><span style={label}>User ID:</span> <code style={{ fontSize: 11 }}>{user?.id ?? '-'}</code></div>
      </div>
    </div>
  );
}

// --- T-12.8.2: API Keys ---

function ApiKeysSection() {
  const qc = useQueryClient();
  const { data: envelope } = useQuery({ queryKey: ['api-keys'], queryFn: () => apiGet<ApiKey[]>('/auth/api-keys') });
  const keys = (envelope?.data ?? []) as ApiKey[];

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => apiPost<{ rawKey: string }>('/auth/api-keys', { name: newKeyName, scopes: newKeyScopes }),
    onSuccess: (data) => {
      setCreatedKey((data.data as { rawKey: string })?.rawKey ?? null);
      setNewKeyName('');
      setNewKeyScopes([]);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/auth/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  };

  return (
    <div style={{ ...card, marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={sectionTitle}>API Keys</h3>
        <button onClick={() => { setShowCreate(true); setCreatedKey(null); }}
          style={{ fontSize: 12, padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
          Create Key
        </button>
      </div>

      {/* Created key alert */}
      {createdKey && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 12, marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Copy your API key — it won't be shown again:</p>
          <code style={{ fontSize: 12, wordBreak: 'break-all', background: '#fff', padding: 8, display: 'block', borderRadius: 4, border: '1px solid #e5e7eb' }}>{createdKey}</code>
        </div>
      )}

      {/* Create form */}
      {showCreate && !createdKey && (
        <div style={{ background: '#f9fafb', borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>Name</label>
            <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g., CI Pipeline"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Scopes</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SCOPES.map((s) => (
                <label key={s} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newKeyScopes.includes(s)} onChange={() => toggleScope(s)} /> {s}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => createMutation.mutate()} disabled={!newKeyName || newKeyScopes.length === 0}
              style={{ fontSize: 12, padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Create</button>
            <button onClick={() => setShowCreate(false)} style={{ fontSize: 12, padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Keys list */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ borderBottom: '1px solid #e5e7eb' }}>
          <th style={th}>Name</th><th style={th}>Prefix</th><th style={th}>Scopes</th><th style={th}>Last Used</th><th style={th}></th>
        </tr></thead>
        <tbody>
          {keys.length === 0 ? <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#999' }}>No API keys</td></tr>
          : keys.map((k) => (
            <tr key={k.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{k.name}</td>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{k.keyPrefix}...</td>
              <td style={{ ...td, fontSize: 11 }}>{k.scopes.join(', ')}</td>
              <td style={{ ...td, fontSize: 12, color: '#666' }}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <button onClick={() => { if (confirm('Revoke this key?')) revokeMutation.mutate(k.id); }}
                  style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Revoke</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- T-12.8.3: Notification Preferences ---

function NotificationPrefsSection() {
  const qc = useQueryClient();
  const { data: envelope } = useQuery({ queryKey: ['notification-preferences'], queryFn: () => apiGet<NotifPref[]>('/notification-preferences') });
  const prefs = (envelope?.data ?? []) as NotifPref[];

  const updateMutation = useMutation({
    mutationFn: (updates: Array<{ channel: string; eventType: string; enabled: boolean }>) =>
      apiPut('/notification-preferences', { preferences: updates }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  const isEnabled = (channel: string, eventType: string) => prefs.find((p) => p.channel === channel && p.eventType === eventType)?.enabled ?? false;

  const toggle = (channel: string, eventType: string) => {
    const current = isEnabled(channel, eventType);
    updateMutation.mutate([{ channel, eventType, enabled: !current }]);
  };

  return (
    <div style={{ ...card, marginTop: 20 }}>
      <h3 style={sectionTitle}>Notification Preferences</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ borderBottom: '2px solid #e5e7eb' }}>
          <th style={{ ...th, width: '40%' }}>Event</th>
          <th style={{ ...th, textAlign: 'center' }}>Slack</th>
          <th style={{ ...th, textAlign: 'center' }}>Email</th>
        </tr></thead>
        <tbody>
          {EVENT_TYPES.map((et) => (
            <tr key={et} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{EVENT_LABELS[et]}</td>
              <td style={{ ...td, textAlign: 'center' }}>
                <ToggleSwitch checked={isEnabled('slack', et)} onChange={() => toggle('slack', et)} />
              </td>
              <td style={{ ...td, textAlign: 'center' }}>
                <ToggleSwitch checked={isEnabled('email', et)} onChange={() => toggle('email', et)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} style={{
      width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
      background: checked ? '#2563eb' : '#d1d5db', position: 'relative', transition: 'background 0.2s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 12, marginTop: 0 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '10px 12px' };
const label: React.CSSProperties = { color: '#999', fontSize: 11, textTransform: 'uppercase', display: 'block', marginBottom: 2 };
