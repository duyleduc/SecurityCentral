import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert,
  Switch, FormControlLabel, IconButton,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SettingsIcon from '@mui/icons-material/Settings';
import GitHubIcon from '@mui/icons-material/GitHub';
import CodeIcon from '@mui/icons-material/Code';
import {
  useIntegrations,
  useConnectGitHub,
  useConnectGitHubPAT,
  useConnectGitLab,
  useDeleteIntegration,
  type Integration,
} from '../../api/hooks';

const PROVIDERS = [
  { key: 'github' as const, label: 'GitHub', icon: <GitHubIcon />, desc: 'Repository scanning, webhooks, push-triggered scans' },
  { key: 'gitlab' as const, label: 'GitLab', icon: <CodeIcon />, desc: 'Repository scanning and push webhooks (cloud + self-hosted)' },
];

export function IntegrationsSection() {
  const navigate = useNavigate();
  const { data: integrations } = useIntegrations();
  const deleteIntegration = useDeleteIntegration();
  const [modal, setModal] = useState<string | null>(null);

  const getIntegration = (provider: string): Integration | undefined =>
    integrations?.find((i) => i.provider === provider);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Integrations</Typography>

      <Grid container spacing={2}>
        {PROVIDERS.map((p) => {
          const existing = getIntegration(p.key);
          const connected = !!existing;

          return (
            <Grid size={{ xs: 12, sm: 6 }} key={p.key}>
              <Card sx={{
                height: '100%',
                border: '2px solid',
                borderColor: connected ? 'success.main' : 'transparent',
              }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    {p.icon}
                    <Typography variant="h6">{p.label}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                    {p.desc}
                  </Typography>

                  <Box sx={{ mt: 'auto' }}>
                    {connected ? (
                      <Stack spacing={1}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Chip label="Connected" size="small" color="success" />
                          <Typography variant="body2" color="text.secondary">
                            {existing!._count?.repositories ?? 0} repos
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                            {new Date(existing!.createdAt).toLocaleDateString()}
                          </Typography>
                        </Stack>
                        <Button
                          variant="contained"
                          size="small"
                          fullWidth
                          startIcon={<SettingsIcon />}
                          onClick={() => navigate(`/integrations/${p.key}/repos`)}
                        >
                          Manage Repositories
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          fullWidth
                          startIcon={<LinkOffIcon />}
                          onClick={() => {
                            if (confirm(`Disconnect ${p.label}?`)) deleteIntegration.mutate(existing!.id);
                          }}
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

      {modal === 'github' && <GitHubModal onClose={() => setModal(null)} />}
      {modal === 'gitlab' && <GitLabModal onClose={() => setModal(null)} />}
    </Box>
  );
}

function GitHubModal({ onClose }: { onClose: () => void }) {
  const connectPAT = useConnectGitHubPAT();
  const connectApp = useConnectGitHub();

  const [mode, setMode] = useState<'pat' | 'app'>('pat');

  // PAT fields
  const [token, setToken] = useState('');
  const [isEnterprise, setIsEnterprise] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [verifySsl, setVerifySsl] = useState(true);

  // App fields (advanced)
  const [installationId, setInstallationId] = useState('');
  const [appId, setAppId] = useState('');

  const handleConnect = async () => {
    if (mode === 'pat') {
      await connectPAT.mutateAsync({
        accessToken: token,
        ...(isEnterprise && baseUrl ? { baseUrl } : {}),
        ...(isEnterprise ? { verifySsl } : {}),
      });
    } else {
      await connectApp.mutateAsync({ installationId, appId: appId || undefined });
    }
    onClose();
  };

  const pending = mode === 'pat' ? connectPAT.isPending : connectApp.isPending;
  const error = mode === 'pat' ? connectPAT.error : connectApp.error;
  const canSubmit = mode === 'pat'
    ? token.trim().length > 0 && (!isEnterprise || baseUrl.trim().length > 0)
    : installationId.trim().length > 0;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect GitHub</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Chip
            label="Personal access token"
            color={mode === 'pat' ? 'primary' : 'default'}
            variant={mode === 'pat' ? 'filled' : 'outlined'}
            onClick={() => setMode('pat')}
            clickable
          />
          <Chip
            label="GitHub App (advanced)"
            color={mode === 'app' ? 'primary' : 'default'}
            variant={mode === 'app' ? 'filled' : 'outlined'}
            onClick={() => setMode('app')}
            clickable
          />
        </Stack>

        {mode === 'pat' ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Create a token at{' '}
              <a href="https://github.com/settings/tokens/new?scopes=repo&description=SecurityCentral" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                github.com/settings/tokens
              </a>
              {' '}with the <code>repo</code> scope (or a fine-grained token with repository read access).
            </Typography>
            <TextField
              fullWidth type="password" label="Personal access token" value={token}
              onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…"
              size="small" sx={{ mb: 2 }}
            />
            <FormControlLabel
              control={<Switch checked={isEnterprise} onChange={(e) => setIsEnterprise(e.target.checked)} />}
              label="GitHub Enterprise Server (self-hosted)"
              sx={{ mb: 1 }}
            />
            {isEnterprise && (
              <>
                <TextField
                  fullWidth label="Instance URL" value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://github.your-company.com" size="small" sx={{ mb: 2 }}
                />
                <FormControlLabel
                  control={<Switch checked={verifySsl} onChange={(e) => setVerifySsl(e.target.checked)} />}
                  label="Verify SSL certificate" sx={{ mb: 1 }}
                />
                {!verifySsl && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    SSL verification is disabled. Only use this for trusted internal instances with self-signed certificates.
                  </Alert>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Install the SecurityCentral GitHub App on your organization, then enter the installation details below.
            </Typography>
            <TextField
              fullWidth label="Installation ID" value={installationId}
              onChange={(e) => setInstallationId(e.target.value)}
              placeholder="12345678" size="small" sx={{ mb: 2 }}
            />
            <TextField
              fullWidth label="App ID (optional)" value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="67890" size="small"
            />
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>{(error as Error).message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConnect} disabled={!canSubmit || pending}>
          {pending ? 'Verifying…' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GitLabModal({ onClose }: { onClose: () => void }) {
  const connectGitLab = useConnectGitLab();
  const [token, setToken] = useState('');
  const [isSelfHosted, setIsSelfHosted] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [verifySsl, setVerifySsl] = useState(true);

  const handleConnect = async () => {
    await connectGitLab.mutateAsync({
      accessToken: token,
      ...(isSelfHosted && baseUrl ? { baseUrl } : {}),
      ...(isSelfHosted ? { verifySsl } : {}),
    });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect GitLab</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth type="password" label="Access Token" value={token}
          onChange={(e) => setToken(e.target.value)} placeholder="glpat-xxxx" size="small"
          helperText="Create a token with api scope in GitLab Settings > Access Tokens"
          sx={{ mt: 1, mb: 2 }}
        />
        <FormControlLabel
          control={<Switch checked={isSelfHosted} onChange={(e) => setIsSelfHosted(e.target.checked)} />}
          label="Self-hosted GitLab instance"
          sx={{ mb: 2 }}
        />
        {isSelfHosted && (
          <>
            <TextField
              fullWidth label="Instance URL" value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://gitlab.your-company.com" size="small" sx={{ mb: 2 }}
            />
            <FormControlLabel
              control={<Switch checked={verifySsl} onChange={(e) => setVerifySsl(e.target.checked)} />}
              label="Verify SSL certificate" sx={{ mb: 1 }}
            />
            {!verifySsl && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                SSL verification is disabled. Only use this for trusted internal instances with self-signed certificates.
              </Alert>
            )}
          </>
        )}
        {connectGitLab.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>{(connectGitLab.error as Error).message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained" onClick={handleConnect}
          disabled={!token || (isSelfHosted && !baseUrl) || connectGitLab.isPending}
        >
          {connectGitLab.isPending ? 'Testing connection...' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
