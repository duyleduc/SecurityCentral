import { useState, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, Switch, Stack, Button,
  Table, TableHead, TableRow, TableCell, TableBody,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  MenuItem, Alert, IconButton, Tooltip,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import ChatIcon from '@mui/icons-material/Chat';
import LinkIcon from '@mui/icons-material/Link';
import SettingsIcon from '@mui/icons-material/Settings';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
  useNotificationPreferences,
  useUpsertNotificationPref,
  useSendTestNotification,
  type NotificationPreference,
} from '../../api/hooks';

const EVENT_LABELS: Record<string, string> = {
  'finding:new': 'New Finding',
  'finding:resolved': 'Finding Resolved',
  'scan:completed': 'Scan Completed',
  'agent:connected': 'Agent Connected',
  'agent:disconnected': 'Server Offline',
  'cert:expiring': 'SSL Certificate Expiring',
  'brute_force:active': 'Active Brute Force Attack',
  'cve:critical': 'Critical CVE Detected',
};

const EVENT_TYPES = Object.keys(EVENT_LABELS);
const CHANNELS = ['email', 'slack', 'webhook'] as const;
type Channel = (typeof CHANNELS)[number];

const SEVERITY_OPTIONS = [
  { value: '', label: 'Any severity' },
  { value: 'low', label: 'Low and above' },
  { value: 'medium', label: 'Medium and above' },
  { value: 'high', label: 'High and above' },
  { value: 'critical', label: 'Critical only' },
];

const channelIcon = (ch: Channel) => {
  switch (ch) {
    case 'email': return <EmailIcon fontSize="small" />;
    case 'slack': return <ChatIcon fontSize="small" />;
    case 'webhook': return <LinkIcon fontSize="small" />;
  }
};

interface ConfigDialogProps {
  channel: Channel | null;
  initialConfig: Record<string, unknown>;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
}

function ConfigDialog({ channel, initialConfig, onClose, onSave }: ConfigDialogProps) {
  const [recipients, setRecipients] = useState(((initialConfig.recipients as string[]) ?? []).join(', '));
  const [webhookUrl, setWebhookUrl] = useState((initialConfig.webhookUrl as string) ?? '');
  const [url, setUrl] = useState((initialConfig.url as string) ?? '');
  const [secret, setSecret] = useState((initialConfig.secret as string) ?? '');
  const [minSeverity, setMinSeverity] = useState((initialConfig.minSeverity as string) ?? '');

  const handleSave = () => {
    const config: Record<string, unknown> = { minSeverity: minSeverity || undefined };
    if (channel === 'email') {
      config.recipients = recipients
        .split(',').map((s) => s.trim()).filter(Boolean);
    } else if (channel === 'slack') {
      config.webhookUrl = webhookUrl.trim();
    } else if (channel === 'webhook') {
      config.url = url.trim();
      config.secret = secret.trim() || undefined;
    }
    onSave(config);
  };

  if (!channel) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Configure {channel} channel</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {channel === 'email' && (
            <>
              <TextField
                label="Recipients (comma-separated)"
                placeholder="ops@example.com, security@example.com"
                helperText="Leave empty to send to all org owners and admins"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                fullWidth multiline minRows={2}
              />
            </>
          )}
          {channel === 'slack' && (
            <>
              <TextField
                label="Slack Incoming Webhook URL"
                placeholder="https://hooks.slack.com/services/..."
                helperText="Create one at api.slack.com/messaging/webhooks"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                fullWidth required
              />
            </>
          )}
          {channel === 'webhook' && (
            <>
              <TextField
                label="Webhook URL"
                placeholder="https://your-server.example.com/notifications"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                fullWidth required
              />
              <TextField
                label="Signing secret (optional)"
                placeholder="Used for X-SC-Signature HMAC-SHA256 header"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                fullWidth
              />
              <Alert severity="info">
                Each request includes <code>X-SC-Event</code> and <code>X-SC-Signature</code> headers.
                Verify the signature server-side using HMAC-SHA256 with the body.
              </Alert>
            </>
          )}
          <TextField
            select label="Minimum severity"
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value)}
            helperText="Filter out lower-severity events for this channel"
            fullWidth
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export function NotificationsSection() {
  const { data: prefs } = useNotificationPreferences();
  const upsert = useUpsertNotificationPref();
  const sendTest = useSendTestNotification();
  const [configChannel, setConfigChannel] = useState<Channel | null>(null);
  const [testEvent, setTestEvent] = useState<string>('finding:new');
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  // Lookup map: "channel:eventType" -> preference
  const prefMap = useMemo(() => {
    const m = new Map<string, NotificationPreference>();
    for (const p of prefs ?? []) m.set(`${p.channel}:${p.eventType}`, p);
    return m;
  }, [prefs]);

  // Channel-level config: take from any preference for that channel (config is shared per channel).
  const channelConfig = (channel: Channel): Record<string, unknown> => {
    for (const p of prefs ?? []) {
      if (p.channel === channel && p.config) return p.config;
    }
    return {};
  };

  const isEnabled = (channel: Channel, eventType: string): boolean =>
    prefMap.get(`${channel}:${eventType}`)?.enabled ?? false;

  const isChannelConfigured = (channel: Channel): boolean => {
    const cfg = channelConfig(channel);
    if (channel === 'email') return true; // falls back to org admins
    if (channel === 'slack') return !!cfg.webhookUrl;
    if (channel === 'webhook') return !!cfg.url;
    return false;
  };

  const toggle = (channel: Channel, eventType: string) => {
    const enabled = !isEnabled(channel, eventType);
    upsert.mutate({
      channel,
      eventType,
      enabled,
      config: channelConfig(channel), // preserve channel config across toggles
    });
  };

  const saveChannelConfig = (channel: Channel, config: Record<string, unknown>) => {
    // Apply config to all events for this channel.
    for (const et of EVENT_TYPES) {
      const enabled = isEnabled(channel, et);
      upsert.mutate({ channel, eventType: et, enabled, config });
    }
    setConfigChannel(null);
  };

  const handleTest = () => {
    setTestFeedback(null);
    sendTest.mutate(testEvent, {
      onSuccess: (data) => {
        setTestFeedback(data.channels > 0
          ? `Test notification dispatched to ${data.channels} channel(s). Check your inbox / Slack / webhook receiver.`
          : 'No channels enabled for this event. Toggle one on first.');
      },
      onError: (err) => setTestFeedback(`Test failed: ${(err as Error).message}`),
    });
  };

  return (
    <Stack spacing={3}>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Box>
              <Typography variant="h6">Notification Channels</Typography>
              <Typography variant="body2" color="text.secondary">
                Configure delivery endpoints. A channel must be configured before notifications can be sent.
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={2}>
            {CHANNELS.map((ch) => {
              const configured = isChannelConfigured(ch);
              return (
                <Card key={ch} variant="outlined" sx={{ flex: 1 }}>
                  <CardContent>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {channelIcon(ch)}
                        <Typography variant="subtitle1" sx={{ textTransform: 'capitalize' }}>{ch}</Typography>
                      </Stack>
                      <IconButton size="small" onClick={() => setConfigChannel(ch)} title="Configure">
                        <SettingsIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <Typography variant="caption" color={configured ? 'success.main' : 'warning.main'}>
                      {configured ? '✓ Configured' : 'Not configured'}
                    </Typography>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
            <Box>
              <Typography variant="h6">Event Subscriptions</Typography>
              <Typography variant="body2" color="text.secondary">
                Choose which events trigger notifications for each channel.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                select size="small" value={testEvent}
                onChange={(e) => setTestEvent(e.target.value)}
                sx={{ minWidth: 200 }}
              >
                {EVENT_TYPES.map((et) => (
                  <MenuItem key={et} value={et}>{EVENT_LABELS[et]}</MenuItem>
                ))}
              </TextField>
              <Tooltip title="Send a test notification for the selected event to all enabled channels">
                <Button
                  variant="outlined" size="small" startIcon={<PlayArrowIcon />}
                  onClick={handleTest} disabled={sendTest.isPending}
                >
                  Test
                </Button>
              </Tooltip>
            </Stack>
          </Stack>

          {testFeedback && (
            <Alert severity={testFeedback.startsWith('Test failed') ? 'error' : 'success'} sx={{ mb: 2 }} onClose={() => setTestFeedback(null)}>
              {testFeedback}
            </Alert>
          )}

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Event</TableCell>
                {CHANNELS.map((ch) => (
                  <TableCell key={ch} align="center" sx={{ textTransform: 'capitalize' }}>
                    <Stack direction="row" justifyContent="center" alignItems="center" spacing={0.5}>
                      {channelIcon(ch)}
                      <span>{ch}</span>
                    </Stack>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {EVENT_TYPES.map((et) => (
                <TableRow key={et}>
                  <TableCell>
                    <Stack>
                      <Typography variant="body2" fontWeight={500}>{EVENT_LABELS[et]}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.65rem' }}>{et}</Typography>
                    </Stack>
                  </TableCell>
                  {CHANNELS.map((ch) => (
                    <TableCell key={ch} align="center">
                      <Tooltip title={isChannelConfigured(ch) ? '' : `Configure ${ch} channel first`}>
                        <span>
                          <Switch
                            size="small"
                            checked={isEnabled(ch, et)}
                            onChange={() => toggle(ch, et)}
                            disabled={!isChannelConfigured(ch)}
                          />
                        </span>
                      </Tooltip>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {configChannel && (
        <ConfigDialog
          channel={configChannel}
          initialConfig={channelConfig(configChannel)}
          onClose={() => setConfigChannel(null)}
          onSave={(cfg) => saveChannelConfig(configChannel, cfg)}
        />
      )}
    </Stack>
  );
}
