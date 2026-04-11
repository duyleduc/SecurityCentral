import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Stack, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Chip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '../../api/hooks';

export function ApiKeysSection() {
  const { data: keys } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const handleCreate = async () => {
    const result = await createKey.mutateAsync({ name: newKeyName });
    setCreatedKey(result.key);
    setNewKeyName('');
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">API Keys</Typography>
            <Button variant="contained" size="small" onClick={() => { setDialogOpen(true); setCreatedKey(null); }}>
              Create API Key
            </Button>
          </Stack>

          {keys && keys.length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Key Prefix</TableCell>
                  <TableCell>Last Used</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {keys.map((k: any) => (
                  <TableRow key={k.id}>
                    <TableCell>{k.name}</TableCell>
                    <TableCell>
                      <Chip label={`${k.keyPrefix}...`} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }} />
                    </TableCell>
                    <TableCell>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}</TableCell>
                    <TableCell>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}</TableCell>
                    <TableCell>{new Date(k.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <IconButton size="small" color="error" onClick={() => revokeKey.mutate(k.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography color="text.secondary">No API keys yet.</Typography>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create API Key</DialogTitle>
        <DialogContent>
          {createdKey ? (
            <Box>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Copy this key now. It will not be shown again.
              </Alert>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  fullWidth
                  value={createdKey}
                  InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
                  size="small"
                />
                <IconButton onClick={() => handleCopy(createdKey)}>
                  <ContentCopyIcon />
                </IconButton>
              </Stack>
            </Box>
          ) : (
            <TextField
              fullWidth
              label="Key Name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              margin="normal"
              placeholder="e.g. CI/CD Pipeline"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{createdKey ? 'Done' : 'Cancel'}</Button>
          {!createdKey && (
            <Button variant="contained" onClick={handleCreate} disabled={!newKeyName || createKey.isPending}>
              {createKey.isPending ? 'Creating...' : 'Create'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
