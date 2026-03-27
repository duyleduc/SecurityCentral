import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField, Chip, Alert,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell,
  Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel,
  Stack, Paper, Skeleton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
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
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>Settings</Typography>
      <OrgInfo />
      <ApiKeysSection />
      <NotificationPrefsSection />
    </Box>
  );
}

function OrgInfo() {
  const { user } = useAuth();
  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Organization</Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
              Role
            </Typography>
            <Typography variant="body2">{user?.role ?? '-'}</Typography>
          </Grid>
          <Grid item xs={6}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>
              User ID
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{user?.id ?? '-'}</Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

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

  const handleCloseDialog = () => {
    setShowCreate(false);
    setCreatedKey(null);
    setNewKeyName('');
    setNewKeyScopes([]);
  };

  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">API Keys</Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => { setShowCreate(true); setCreatedKey(null); }}
          >
            Create Key
          </Button>
        </Stack>

        {/* Created key alert */}
        {createdKey && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Copy your API key -- it won't be shown again:
            </Typography>
            <Box sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all', bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              {createdKey}
            </Box>
          </Alert>
        )}

        {/* Create Dialog */}
        <Dialog open={showCreate && !createdKey} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., CI Pipeline"
              size="small"
              sx={{ mt: 1, mb: 2 }}
            />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Scopes</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {SCOPES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  size="small"
                  variant={newKeyScopes.includes(s) ? 'filled' : 'outlined'}
                  color={newKeyScopes.includes(s) ? 'primary' : 'default'}
                  onClick={() => toggleScope(s)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => createMutation.mutate()}
              disabled={!newKeyName || newKeyScopes.length === 0}
            >
              Create
            </Button>
          </DialogActions>
        </Dialog>

        {/* Keys table */}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Prefix</TableCell>
                <TableCell>Scopes</TableCell>
                <TableCell>Last Used</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>No API keys</TableCell>
                </TableRow>
              ) : keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{k.keyPrefix}...</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                      {k.scopes.map((s) => <Chip key={s} label={s} size="small" variant="outlined" />)}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={() => { if (confirm('Revoke this key?')) revokeMutation.mutate(k.id); }}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

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
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>Notification Preferences</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '40%' }}>Event</TableCell>
                <TableCell align="center">Slack</TableCell>
                <TableCell align="center">Email</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {EVENT_TYPES.map((et) => (
                <TableRow key={et}>
                  <TableCell>{EVENT_LABELS[et]}</TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={isEnabled('slack', et)}
                      onChange={() => toggle('slack', et)}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={isEnabled('email', et)}
                      onChange={() => toggle('email', et)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}
