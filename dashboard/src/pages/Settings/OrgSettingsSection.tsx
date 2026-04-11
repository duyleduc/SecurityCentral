import { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, Chip, CircularProgress,
} from '@mui/material';
import { useOrganization, useUpdateOrganization, useMembers } from '../../api/hooks';

const ROLE_COLORS: Record<string, string> = {
  owner: '#7c3aed',
  admin: '#2563eb',
  member: '#16a34a',
  viewer: '#9ca3af',
};

export function OrgSettingsSection() {
  const { data: org, isLoading } = useOrganization();
  const { data: members } = useMembers();
  const updateOrg = useUpdateOrganization();
  const [name, setName] = useState('');

  useEffect(() => {
    if (org?.name) setName(org.name);
  }, [org?.name]);

  if (isLoading) return <CircularProgress />;

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Organization</Typography>
          <Stack direction="row" spacing={2} alignItems="flex-end">
            <TextField
              label="Organization Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
              sx={{ minWidth: 300 }}
            />
            <Button
              variant="contained"
              onClick={() => updateOrg.mutate({ name })}
              disabled={updateOrg.isPending || name === org?.name}
            >
              {updateOrg.isPending ? 'Saving...' : 'Save'}
            </Button>
          </Stack>
          {org && (
            <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">Plan: <b>{org.plan}</b></Typography>
              <Typography variant="body2" color="text.secondary">Slug: <b>{org.slug}</b></Typography>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Team Members</Typography>
          {members && members.length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Joined</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {members.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.name}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>
                      <Chip label={m.role} size="small" sx={{ bgcolor: ROLE_COLORS[m.role] ?? '#9ca3af', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }} />
                    </TableCell>
                    <TableCell>{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography color="text.secondary">No members found.</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
