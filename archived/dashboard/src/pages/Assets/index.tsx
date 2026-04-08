import { Link as RouterLink } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';
import { RepositoriesList } from './RepositoriesList.js';
import { ServersList } from './ServersList.js';
import { CertificatesList } from './CertificatesList.js';

export function AssetsPage({ tab }: { tab: 'repositories' | 'servers' | 'certificates' }) {
  const tabIndex = tab === 'servers' ? 0 : tab === 'repositories' ? 1 : 2;

  return (
    <Box>
      <Tabs
        value={tabIndex}
        sx={{ mb: 2 }}
        textColor="primary"
        indicatorColor="primary"
      >
        <Tab label="Servers" component={RouterLink} to="/assets/servers" />
        <Tab label="Repositories" component={RouterLink} to="/assets/repositories" />
        <Tab label="Certificates" component={RouterLink} to="/assets/certificates" />
      </Tabs>
      {tab === 'repositories' && <RepositoriesList />}
      {tab === 'servers' && <ServersList />}
      {tab === 'certificates' && <CertificatesList />}
    </Box>
  );
}
