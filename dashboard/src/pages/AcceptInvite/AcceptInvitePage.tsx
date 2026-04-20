import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack, Alert,
  CircularProgress, Chip,
} from '@mui/material';
import { useInvitationDetails } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { acceptInvitation } = useAuth();
  const { data: details, isLoading, error } = useInvitationDetails(token ?? '');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const passwordOk = password.length >= 8;
  const passwordsMatch = password === confirm;
  const canSubmit = passwordOk && passwordsMatch && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await acceptInvitation(token, password);
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !details) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Card sx={{ maxWidth: 420, width: '100%' }}>
          <CardContent>
            <Typography variant="h6" color="error" sx={{ mb: 1 }}>Invitation unavailable</Typography>
            <Typography variant="body2" color="text.secondary">
              {(error as Error | undefined)?.message ?? 'This invitation link is invalid or has expired. Ask your admin to send a new one.'}
            </Typography>
            <Button sx={{ mt: 2 }} onClick={() => navigate('/login')}>Go to sign in</Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Card sx={{ maxWidth: 460, width: '100%' }}>
        <CardContent>
          <Typography variant="h5" sx={{ mb: 0.5 }}>Join {details.org.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Set a password for <strong>{details.email}</strong> to finish creating your account.
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mb: 2.5 }}>
            <Chip label={`Role: ${details.role}`} size="small" color={details.role === 'admin' ? 'primary' : 'default'} variant="outlined" />
            <Chip label={`Expires ${new Date(details.expiresAt).toLocaleString()}`} size="small" variant="outlined" />
          </Stack>

          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Your name"
                value={details.name}
                size="small"
                fullWidth
                slotProps={{ input: { readOnly: true } }}
                helperText="Ask your admin if this needs to change"
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                size="small"
                fullWidth
                autoFocus
                error={password.length > 0 && !passwordOk}
                helperText={password.length > 0 && !passwordOk ? 'At least 8 characters' : 'At least 8 characters'}
              />
              <TextField
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                size="small"
                fullWidth
                error={confirm.length > 0 && !passwordsMatch}
                helperText={confirm.length > 0 && !passwordsMatch ? 'Passwords do not match' : ''}
              />

              {submitError && <Alert severity="error">{submitError}</Alert>}

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={!canSubmit}
              >
                {submitting ? 'Creating account...' : 'Create account & join'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
