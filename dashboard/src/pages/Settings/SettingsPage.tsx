import { Box, Typography, Card, CardContent } from '@mui/material';

export function SettingsPage() {
  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Settings
      </Typography>
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
