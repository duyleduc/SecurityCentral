import { Box, Typography, Card, CardContent } from '@mui/material';

export function FindingsPage() {
  return (
    <Box>
      <Typography variant="h4" mb={3}>
        Findings
      </Typography>
      <Card>
        <CardContent>
          <Typography color="text.secondary">
            Findings and security scoring will be available in Phase 3.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
