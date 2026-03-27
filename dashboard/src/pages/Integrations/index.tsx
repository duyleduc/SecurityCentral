import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../../api/client.js';

interface Integration {
  id: string;
  provider: string;
  status: string;
  createdAt: string;
}

const PROVIDERS = [
  { key: 'github', label: 'GitHub', icon: '🐙', desc: 'Repository scanning, webhooks, auto-fix PRs' },
  { key: 'gitlab', label: 'GitLab', icon: '🦊', desc: 'Repository scanning and push webhooks' },
  { key: 'slack', label: 'Slack', icon: '💬', desc: 'Security alerts and notifications' },
  { key: 'aws', label: 'AWS', icon: '🟧', desc: 'EC2 instance discovery for infrastructure coverage' },
  { key: 'azure', label: 'Azure', icon: '🔵', desc: 'Virtual machine discovery across resource groups' },
  { key: 'gcp', label: 'GCP', icon: '🔴', desc: 'Compute Engine instance discovery across zones' },
];

export function IntegrationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: envelope, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiGet<Integration[]>('/integrations'),
  });
  const integrations = (envelope?.data ?? []) as Integration[];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/integrations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const [modal, setModal] = useState<string | null>(null);

  const getIntegration = (provider: string) => integrations.find((i) => i.provider === provider);

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Integrations</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {PROVIDERS.map((p) => {
          const existing = getIntegration(p.key);
          const connected = !!existing;

          return (
            <div key={p.key} style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: connected ? '2px solid #16a34a' : '2px solid transparent' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{p.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{p.label}</h3>
              <p style={{ fontSize: 12, color: '#666', marginBottom: 16, minHeight: 32 }}>{p.desc}</p>

              {connected ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Connected</span>
                    <span style={{ fontSize: 11, color: '#999', marginLeft: 'auto' }}>
                      {new Date(existing!.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {(p.key === 'github' || p.key === 'gitlab') && (
                    <button onClick={() => navigate(`/integrations/${p.key}/repos`)}
                      style={{ fontSize: 12, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 4, padding: '6px 12px', cursor: 'pointer', width: '100%', fontWeight: 600, marginBottom: 8 }}>
                      Manage Repositories
                    </button>
                  )}
                  <button onClick={() => { if (confirm(`Disconnect ${p.label}?`)) deleteMutation.mutate(existing!.id); }}
                    style={{ fontSize: 12, color: '#dc2626', background: 'none', border: '1px solid #dc2626', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', width: '100%' }}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <button onClick={() => setModal(p.key)}
                  style={{ fontSize: 12, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 4, padding: '8px 16px', cursor: 'pointer', width: '100%', fontWeight: 600 }}>
                  Connect {p.label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Connection modals */}
      {modal === 'github' && <GitHubModal onClose={() => setModal(null)} />}
      {modal === 'gitlab' && <GitLabModal onClose={() => setModal(null)} />}
      {modal === 'slack' && <SlackModal onClose={() => setModal(null)} />}
      {modal === 'aws' && <AwsModal onClose={() => setModal(null)} />}
      {modal === 'azure' && <AzureModal onClose={() => setModal(null)} />}
      {modal === 'gcp' && <GcpModal onClose={() => setModal(null)} />}
    </div>
  );
}

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 400, maxHeight: '80vh', overflow: 'auto' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function GitHubModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [installationId, setInstallationId] = useState('');
  const [appId, setAppId] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/github', { installationId, appId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <ModalWrapper title="Connect GitHub" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Install the SecurityCentral GitHub App, then enter the installation details below.</p>
      <div style={{ marginBottom: 12 }}>
        <label style={formLabel}>Installation ID</label>
        <input value={installationId} onChange={(e) => setInstallationId(e.target.value)} style={formInput} placeholder="12345678" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={formLabel}>App ID</label>
        <input value={appId} onChange={(e) => setAppId(e.target.value)} style={formInput} placeholder="67890" />
      </div>
      {mutation.isError && <div style={errorBox}>{(mutation.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!installationId || !appId || mutation.isPending} style={submitBtn}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </ModalWrapper>
  );
}

function GitLabModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/gitlab', { accessToken: token }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <ModalWrapper title="Connect GitLab" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label style={formLabel}>Access Token</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} style={formInput} placeholder="glpat-xxxx" />
        <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Create a token with <code>api</code> scope in GitLab Settings → Access Tokens</p>
      </div>
      {mutation.isError && <div style={errorBox}>{(mutation.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!token || mutation.isPending} style={submitBtn}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </ModalWrapper>
  );
}

function SlackModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/slack', { webhookUrl: url }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <ModalWrapper title="Connect Slack" onClose={onClose}>
      <div style={{ marginBottom: 16 }}>
        <label style={formLabel}>Webhook URL</label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} style={formInput} placeholder="https://hooks.slack.com/services/T00/B00/xxxx" />
        <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Create an incoming webhook in Slack App settings</p>
      </div>
      {mutation.isError && <div style={errorBox}>{(mutation.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!url || mutation.isPending} style={submitBtn}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </ModalWrapper>
  );
}

const formLabel: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 };
const formInput: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' };
function AwsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/aws', { region, ...(accessKeyId ? { accessKeyId, secretAccessKey } : {}), ...(roleArn ? { roleArn } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); qc.invalidateQueries({ queryKey: ['coverage-stats'] }); onClose(); },
  });

  return (
    <ModalWrapper title="Connect AWS" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Provide read-only credentials to discover EC2 instances.</p>
      <div style={{ marginBottom: 12 }}><label style={formLabel}>Region</label><input value={region} onChange={(e) => setRegion(e.target.value)} style={formInput} /></div>
      <div style={{ marginBottom: 12 }}><label style={formLabel}>Access Key ID (optional if using IAM role)</label><input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} style={formInput} /></div>
      <div style={{ marginBottom: 12 }}><label style={formLabel}>Secret Access Key</label><input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} style={formInput} /></div>
      <div style={{ marginBottom: 16 }}><label style={formLabel}>Role ARN (for cross-account)</label><input value={roleArn} onChange={(e) => setRoleArn(e.target.value)} style={formInput} placeholder="arn:aws:iam::123456:role/sc-discovery" /></div>
      {mutation.isError && <div style={errorBox}>{(mutation.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!region || mutation.isPending} style={submitBtn}>{mutation.isPending ? 'Connecting...' : 'Connect'}</button>
      </div>
    </ModalWrapper>
  );
}

function AzureModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/azure', { tenantId, clientId, clientSecret }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <ModalWrapper title="Connect Azure" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Provide a service principal with Reader role to discover VMs.</p>
      <div style={{ marginBottom: 12 }}><label style={formLabel}>Tenant ID</label><input value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={formInput} /></div>
      <div style={{ marginBottom: 12 }}><label style={formLabel}>Client ID</label><input value={clientId} onChange={(e) => setClientId(e.target.value)} style={formInput} /></div>
      <div style={{ marginBottom: 16 }}><label style={formLabel}>Client Secret</label><input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} style={formInput} /></div>
      {mutation.isError && <div style={errorBox}>{(mutation.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!tenantId || !clientId || !clientSecret || mutation.isPending} style={submitBtn}>{mutation.isPending ? 'Connecting...' : 'Connect'}</button>
      </div>
    </ModalWrapper>
  );
}

function GcpModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [serviceAccountKey, setServiceAccountKey] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/gcp', { projectId, ...(serviceAccountKey ? { serviceAccountKey } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <ModalWrapper title="Connect GCP" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Provide a service account with compute.viewer role.</p>
      <div style={{ marginBottom: 12 }}><label style={formLabel}>Project ID</label><input value={projectId} onChange={(e) => setProjectId(e.target.value)} style={formInput} /></div>
      <div style={{ marginBottom: 16 }}>
        <label style={formLabel}>Service Account Key (JSON, optional if on GCE)</label>
        <textarea value={serviceAccountKey} onChange={(e) => setServiceAccountKey(e.target.value)} rows={4} style={{ ...formInput, fontFamily: 'monospace', fontSize: 11 }} placeholder='{"type":"service_account",...}' />
      </div>
      {mutation.isError && <div style={errorBox}>{(mutation.error as Error).message}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtn}>Cancel</button>
        <button onClick={() => mutation.mutate()} disabled={!projectId || mutation.isPending} style={submitBtn}>{mutation.isPending ? 'Connecting...' : 'Connect'}</button>
      </div>
    </ModalWrapper>
  );
}

const cancelBtn: React.CSSProperties = { padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', fontSize: 13, cursor: 'pointer' };
const submitBtn: React.CSSProperties = { padding: '6px 16px', border: 'none', borderRadius: 4, background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const errorBox: React.CSSProperties = { color: '#dc2626', background: '#fef2f2', padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 12 };
