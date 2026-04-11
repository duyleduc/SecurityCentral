import { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { IntegrationsSection } from './IntegrationsSection';
import { OrgSettingsSection } from './OrgSettingsSection';
import { ApiKeysSection } from './ApiKeysSection';
import { NotificationsSection } from './NotificationsSection';

export function SettingsPage() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" mb={2}>Settings</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Organization" />
        <Tab label="Integrations" />
        <Tab label="API Keys" />
        <Tab label="Notifications" />
      </Tabs>

      {tab === 0 && <OrgSettingsSection />}
      {tab === 1 && <IntegrationsSection />}
      {tab === 2 && <ApiKeysSection />}
      {tab === 3 && <NotificationsSection />}
    </Box>
  );
}
