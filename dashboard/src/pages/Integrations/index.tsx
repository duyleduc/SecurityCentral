import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert,
  Switch, FormControlLabel, Skeleton,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SettingsIcon from '@mui/icons-material/Settings';
import { apiGet, apiPost, apiDelete } from '../../api/client.js';

interface Integration {
  id: string;
  provider: string;
  status: string;
  createdAt: string;
}

const PROVIDERS = [
  { key: 'github', label: 'GitHub', desc: 'Repository scanning, webhooks, auto-fix PRs' },
  { key: 'gitlab', label: 'GitLab', desc: 'Repository scanning and push webhooks' },
  { key: 'slack', label: 'Slack', desc: 'Security alerts and notifications' },
  { key: 'aws', label: 'AWS', desc: 'EC2 instance discovery for infrastructure coverage' },
  { key: 'azure', label: 'Azure', desc: 'Virtual machine discovery across resource groups' },
  { key: 'gcp', label: 'GCP', desc: 'Compute Engine instance discovery across zones' },
  { key: 'proxmox', label: 'Proxmox', desc: 'VM and container discovery across cluster nodes' },
  { key: 'bitbucket', label: 'Bitbucket', desc: 'Repository scanning and push webhooks' },
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
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Integrations</Typography>

      <Grid container spacing={2}>
        {PROVIDERS.map((p) => {
          const existing = getIntegration(p.key);
          const connected = !!existing;

          return (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={p.key}>
              <Card sx={{ height: '100%', border: connected ? '2px solid' : '2px solid transparent', borderColor: connected ? 'success.main' : 'transparent' }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Typography variant="h6" sx={{ mb: 0.5 }}>{p.label}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>{p.desc}</Typography>

                  <Box sx={{ mt: 'auto' }}>
                    {connected ? (
                      <Stack spacing={1}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Chip label="Connected" size="small" color="success" />
                          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                            {new Date(existing!.createdAt).toLocaleDateString()}
                          </Typography>
                        </Stack>
                        {(p.key === 'github' || p.key === 'gitlab' || p.key === 'bitbucket') && (
                          <Button
                            variant="contained"
                            size="small"
                            fullWidth
                            startIcon={<SettingsIcon />}
                            onClick={() => navigate(`/integrations/${p.key}/repos`)}
                          >
                            Manage Repositories
                          </Button>
                        )}
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          fullWidth
                          startIcon={<LinkOffIcon />}
                          onClick={() => { if (confirm(`Disconnect ${p.label}?`)) deleteMutation.mutate(existing!.id); }}
                        >
                          Disconnect
                        </Button>
                      </Stack>
                    ) : (
                      <Button
                        variant="contained"
                        fullWidth
                        startIcon={<LinkIcon />}
                        onClick={() => setModal(p.key)}
                      >
                        Connect {p.label}
                      </Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Connection modals */}
      {modal === 'github' && <GitHubModal onClose={() => setModal(null)} />}
      {modal === 'gitlab' && <GitLabModal onClose={() => setModal(null)} />}
      {modal === 'slack' && <SlackModal onClose={() => setModal(null)} />}
      {modal === 'aws' && <AwsModal onClose={() => setModal(null)} />}
      {modal === 'azure' && <AzureModal onClose={() => setModal(null)} />}
      {modal === 'gcp' && <GcpModal onClose={() => setModal(null)} />}
      {modal === 'proxmox' && <ProxmoxModal onClose={() => setModal(null)} />}
      {modal === 'bitbucket' && <BitbucketModal onClose={() => setModal(null)} />}
    </Box>
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
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect GitHub</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Install the SecurityCentral GitHub App, then enter the installation details below.
        </Typography>
        <TextField fullWidth label="Installation ID" value={installationId} onChange={(e) => setInstallationId(e.target.value)} placeholder="12345678" size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="App ID" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="67890" size="small" />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!installationId || !appId || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GitLabModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [isSelfHosted, setIsSelfHosted] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [verifySsl, setVerifySsl] = useState(true);
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/gitlab', {
      accessToken: token,
      ...(isSelfHosted && baseUrl ? { baseUrl } : {}),
      ...(isSelfHosted ? { verifySsl } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect GitLab</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth type="password" label="Access Token" value={token}
          onChange={(e) => setToken(e.target.value)} placeholder="glpat-xxxx" size="small"
          helperText="Create a token with api scope in GitLab Settings -> Access Tokens"
          sx={{ mt: 1, mb: 2 }}
        />
        <FormControlLabel
          control={<Switch checked={isSelfHosted} onChange={(e) => setIsSelfHosted(e.target.checked)} />}
          label="Self-hosted GitLab instance"
          sx={{ mb: 2 }}
        />
        {isSelfHosted && (
          <>
            <TextField fullWidth label="Instance URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.your-company.com" size="small" sx={{ mb: 2 }} />
            <FormControlLabel
              control={<Switch checked={verifySsl} onChange={(e) => setVerifySsl(e.target.checked)} />}
              label="Verify SSL certificate"
              sx={{ mb: 1 }}
            />
            {!verifySsl && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                SSL verification is disabled. Only use this for trusted internal instances with self-signed certificates.
              </Alert>
            )}
          </>
        )}
        {mutation.isError && <Alert severity="error" sx={{ mt: 1 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!token || (isSelfHosted && !baseUrl) || mutation.isPending}>
          {mutation.isPending ? 'Testing connection...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
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
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect Slack</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth type="url" label="Webhook URL" value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/T00/B00/xxxx"
          helperText="Create an incoming webhook in Slack App settings"
          size="small" sx={{ mt: 1 }}
        />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!url || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect AWS</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Provide read-only credentials to discover EC2 instances.
        </Typography>
        <TextField fullWidth label="Region" value={region} onChange={(e) => setRegion(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Access Key ID (optional if using IAM role)" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Secret Access Key" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Role ARN (for cross-account)" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456:role/sc-discovery" size="small" />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!region || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
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
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect Azure</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Provide a service principal with Reader role to discover VMs.
        </Typography>
        <TextField fullWidth label="Tenant ID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Client Secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} size="small" />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!tenantId || !clientId || !clientSecret || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
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
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect GCP</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Provide a service account with compute.viewer role.
        </Typography>
        <TextField fullWidth label="Project ID" value={projectId} onChange={(e) => setProjectId(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField
          fullWidth label="Service Account Key (JSON, optional if on GCE)" value={serviceAccountKey}
          onChange={(e) => setServiceAccountKey(e.target.value)} multiline rows={4}
          placeholder='{"type":"service_account",...}' size="small"
          sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
        />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!projectId || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProxmoxModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [tokenSecret, setTokenSecret] = useState('');
  const [verifySsl, setVerifySsl] = useState(true);
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/proxmox', { baseUrl, tokenId, tokenSecret, verifySsl }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect Proxmox</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Provide API token credentials to discover VMs and containers.
        </Typography>
        <TextField fullWidth label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://proxmox.internal:8006" size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Token ID" value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="user@pam!sc-discovery" size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Token Secret" type="password" value={tokenSecret} onChange={(e) => setTokenSecret(e.target.value)} size="small" sx={{ mb: 2 }} />
        <FormControlLabel
          control={<Switch checked={verifySsl} onChange={(e) => setVerifySsl(e.target.checked)} />}
          label="Verify SSL certificate"
          sx={{ mb: 1 }}
        />
        {!verifySsl && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            Warning: SSL verification is disabled. Only use for trusted internal instances.
          </Alert>
        )}
        {mutation.isError && <Alert severity="error" sx={{ mt: 1 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!baseUrl || !tokenId || !tokenSecret || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BitbucketModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [workspace, setWorkspace] = useState('');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiPost('/integrations/bitbucket', { workspace, username, appPassword, ...(baseUrl ? { baseUrl } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integrations'] }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect Bitbucket</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Provide credentials to discover repositories.
        </Typography>
        <TextField fullWidth label="Workspace" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="my-team" size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Username" value={username} onChange={(e) => setUsername(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="App Password" type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} size="small" sx={{ mb: 2 }} />
        <TextField fullWidth label="Base URL (for Bitbucket Server, leave empty for Cloud)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://bitbucket.internal.corp.com" size="small" />
        {mutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{(mutation.error as Error).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={!workspace || !username || !appPassword || mutation.isPending}>
          {mutation.isPending ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
