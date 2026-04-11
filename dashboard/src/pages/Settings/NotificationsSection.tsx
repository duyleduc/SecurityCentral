import {
  Box, Card, CardContent, Typography, Switch, Stack,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import { useNotificationPreferences, useUpsertNotificationPref } from '../../api/hooks';

const EVENT_LABELS: Record<string, string> = {
  'finding:new': 'New Finding',
  'finding:resolved': 'Finding Resolved',
  'scan:completed': 'Scan Completed',
  'agent:connected': 'Agent Connected',
  'agent:disconnected': 'Agent Disconnected',
  'cert:expiring': 'Certificate Expiring',
};

const CHANNELS = ['email', 'slack', 'webhook'] as const;

const EVENT_TYPES = Object.keys(EVENT_LABELS);

export function NotificationsSection() {
  const { data: prefs } = useNotificationPreferences();
  const upsert = useUpsertNotificationPref();

  const isEnabled = (channel: string, eventType: string): boolean => {
    if (!prefs) return false;
    const match = prefs.find((p: any) => p.channel === channel && p.eventType === eventType);
    return match?.enabled ?? false;
  };

  const toggle = (channel: string, eventType: string) => {
    const current = isEnabled(channel, eventType);
    upsert.mutate({ channel, eventType, enabled: !current });
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Notification Preferences</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Choose which events trigger notifications for each channel.
          </Typography>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Event</TableCell>
                {CHANNELS.map((ch) => (
                  <TableCell key={ch} align="center" sx={{ textTransform: 'capitalize' }}>{ch}</TableCell>
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
                      <Switch
                        size="small"
                        checked={isEnabled(ch, et)}
                        onChange={() => toggle(ch, et)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
