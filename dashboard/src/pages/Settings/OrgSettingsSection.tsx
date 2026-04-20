import { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, Chip, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  Select, MenuItem, IconButton, Tooltip, FormControl, InputLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/PersonAdd';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import {
  useOrganization, useUpdateOrganization, useMembers,
  useUpdateMemberRole, useRemoveMember,
  useInvitations, useCreateInvitation, useRevokeInvitation, useResendInvitation,
  type Member, type Invitation,
} from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';

const ROLE_COLORS: Record<string, string> = {
  owner: '#7c3aed',
  admin: '#2563eb',
  member: '#16a34a',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Full access. Cannot be removed or demoted.',
  admin: 'Can manage the organization, users, servers, domains, and findings.',
  member: 'View-only access to dashboards, servers, domains, and findings.',
};

export function OrgSettingsSection() {
  const { user } = useAuth();
  const { data: org, isLoading } = useOrganization();
  const { data: members } = useMembers();
  const { data: invitations } = useInvitations();
  const updateOrg = useUpdateOrganization();
  const [name, setName] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

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
              disabled={!isAdmin}
            />
            <Button
              variant="contained"
              onClick={() => updateOrg.mutate({ name })}
              disabled={!isAdmin || updateOrg.isPending || name === org?.name}
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

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">Team Members</Typography>
            {isAdmin && (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setInviteOpen(true)}
              >
                Invite Member
              </Button>
            )}
          </Stack>

          {members && members.length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Joined</TableCell>
                  <TableCell align="right" sx={{ width: 60 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {members.map((m) => (
                  <MemberRow key={m.id} member={m} isAdmin={isAdmin} selfId={user?.id} />
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography color="text.secondary">No members found.</Typography>
          )}
        </CardContent>
      </Card>

      {isAdmin && invitations && invitations.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Pending Invitations</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell align="right" sx={{ width: 60 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {invitations.map((inv) => (
                  <PendingInviteRow key={inv.id} invite={inv} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <InviteMemberDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </Box>
  );
}

function MemberRow({ member, isAdmin, selfId }: { member: Member; isAdmin: boolean; selfId?: string }) {
  const isSelf = member.id === selfId;
  const isOwner = member.role === 'owner';
  const canModify = isAdmin && !isSelf && !isOwner;
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell>{member.name}{isSelf && ' (you)'}</TableCell>
        <TableCell>{member.email}</TableCell>
        <TableCell>
          {canModify ? (
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <Select
                value={member.role}
                onChange={(e) => updateRole.mutate({ id: member.id, role: e.target.value as 'member' | 'admin' })}
                disabled={updateRole.isPending}
                sx={{
                  '.MuiSelect-select': { py: 0.5, fontSize: '0.75rem' },
                  bgcolor: `${ROLE_COLORS[member.role]}20`,
                }}
              >
                <MenuItem value="member">member</MenuItem>
                <MenuItem value="admin">admin</MenuItem>
              </Select>
            </FormControl>
          ) : (
            <Tooltip title={ROLE_DESCRIPTIONS[member.role] ?? ''} arrow>
              <Chip
                label={member.role}
                size="small"
                sx={{ bgcolor: ROLE_COLORS[member.role] ?? '#9ca3af', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }}
              />
            </Tooltip>
          )}
        </TableCell>
        <TableCell>{new Date(member.createdAt).toLocaleDateString()}</TableCell>
        <TableCell align="right">
          {canModify && (
            <Tooltip title="Remove member">
              <IconButton
                size="small"
                onClick={() => setConfirmOpen(true)}
                sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove {member.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {member.email} will no longer be able to sign in. This action cannot be undone.
          </Typography>
          {remove.isError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>{(remove.error as Error).message}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={remove.isPending}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => remove.mutate(member.id, { onSuccess: () => setConfirmOpen(false) })}
          >
            {remove.isPending ? 'Removing...' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function PendingInviteRow({ invite }: { invite: Invitation }) {
  const revoke = useRevokeInvitation();
  const resend = useResendInvitation();
  const [resendResult, setResendResult] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);

  const isExpired = new Date(invite.expiresAt).getTime() < Date.now();

  const handleResend = () => {
    resend.mutate(invite.id, {
      onSuccess: (data) => setResendResult(data),
    });
  };

  const handleCopy = () => {
    if (!resendResult?.acceptUrl) return;
    navigator.clipboard.writeText(resendResult.acceptUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <TableRow>
        <TableCell>{invite.name}</TableCell>
        <TableCell>{invite.email}</TableCell>
        <TableCell>
          <Chip
            label={invite.role}
            size="small"
            sx={{ bgcolor: ROLE_COLORS[invite.role] ?? '#9ca3af', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }}
          />
        </TableCell>
        <TableCell>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Chip
              label={isExpired ? 'Expired' : 'Active'}
              size="small"
              color={isExpired ? 'default' : 'success'}
              variant="outlined"
              sx={{ fontSize: '0.65rem', height: 20 }}
            />
            <Typography variant="caption" color="text.secondary">
              {isExpired ? 'expired ' : 'expires '}
              {new Date(invite.expiresAt).toLocaleString()}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" spacing={0.25} justifyContent="flex-end">
            <Tooltip title={isExpired ? 'Send a new invitation link' : 'Resend invitation (new link)'}>
              <span>
                <IconButton
                  size="small"
                  disabled={resend.isPending}
                  onClick={handleResend}
                  sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                >
                  <SendIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Revoke invitation">
              <span>
                <IconButton
                  size="small"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invite.id)}
                  sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </TableCell>
      </TableRow>

      <Dialog open={resendResult !== null} onClose={() => setResendResult(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Invitation Resent</DialogTitle>
        <DialogContent>
          {resendResult && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {resendResult.emailSent ? (
                <Alert severity="success">
                  New email sent to <strong>{resendResult.email}</strong>. The previous link is now invalid.
                </Alert>
              ) : (
                <Alert severity="warning">
                  Email delivery failed or is not configured. Share this link with <strong>{resendResult.email}</strong> manually.
                </Alert>
              )}
              <Box sx={{ position: 'relative' }}>
                <TextField
                  fullWidth
                  value={resendResult.acceptUrl ?? ''}
                  slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } } }}
                />
                <IconButton size="small" onClick={handleCopy} sx={{ position: 'absolute', top: 8, right: 8 }} title="Copy">
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Box>
              {copied && <Typography variant="caption" color="success.main">Copied to clipboard</Typography>}
              <Typography variant="caption" color="text.secondary">
                New expiry: {new Date(resendResult.expiresAt).toLocaleString()}
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResendResult(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function InviteMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [copied, setCopied] = useState(false);
  const create = useCreateInvitation();

  const inviteResult = create.data;
  const inviteUrl = inviteResult?.acceptUrl ?? '';

  const reset = () => { setName(''); setEmail(''); setRole('member'); setCopied(false); create.reset(); };
  const handleClose = () => { reset(); onClose(); };
  const canSubmit = name.trim().length > 0 && email.includes('@');

  const handleSubmit = () => {
    create.mutate({ name: name.trim(), email: email.trim(), role });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{inviteResult ? 'Invitation Created' : 'Invite Member'}</DialogTitle>
      <DialogContent>
        {inviteResult ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {inviteResult.emailSent ? (
              <Alert severity="success">
                Email sent to <strong>{inviteResult.email}</strong>. Keep the link below as a backup in case they don't receive it.
              </Alert>
            ) : (
              <Alert severity="warning">
                Email delivery is not configured (or failed). Share this link with <strong>{inviteResult.email}</strong> manually — it's only shown once.
              </Alert>
            )}
            <Box sx={{ position: 'relative' }}>
              <TextField
                fullWidth
                value={inviteUrl}
                slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
              <IconButton size="small" onClick={handleCopy} sx={{ position: 'absolute', top: 8, right: 8 }} title="Copy">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
            {copied && <Typography variant="caption" color="success.main">Copied to clipboard</Typography>}
            <Typography variant="caption" color="text.secondary">
              Expires: {new Date(inviteResult.expiresAt).toLocaleString()}
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Creates an invitation link. The invitee opens it and sets their own password to join this organization.
            </Typography>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" fullWidth />
            <FormControl size="small" fullWidth>
              <InputLabel>Role</InputLabel>
              <Select value={role} label="Role" onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                <MenuItem value="member">Member — view-only</MenuItem>
                <MenuItem value="admin">Admin — can manage the organization</MenuItem>
              </Select>
            </FormControl>
            {create.isError && (
              <Alert severity="error">{(create.error as Error).message}</Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{inviteResult ? 'Done' : 'Cancel'}</Button>
        {!inviteResult && (
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Creating...' : 'Create Invitation'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
