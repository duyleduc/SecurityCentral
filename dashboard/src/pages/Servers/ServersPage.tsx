import { Box, Typography, Card, CardContent } from '@mui/material';

export function ServersPage() {
  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Servers
      </Typography>
      <Card>
        <CardContent>
          <Typography color="text.secondary">
            Server monitoring will be available in Phase 2. Install the Go agent on your servers to start monitoring.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
