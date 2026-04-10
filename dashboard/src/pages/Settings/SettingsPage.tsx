import { Box, Typography, Card, CardContent, Divider } from '@mui/material';
import { IntegrationsSection } from './IntegrationsSection';

export function SettingsPage() {
  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Settings
      </Typography>

      <IntegrationsSection />

      <Divider sx={{ my: 4 }} />

      <Card>
        <CardContent>
          <Typography color="text.secondary">
            Organization settings, notification preferences, and API key management will be available in Phase 4.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
