import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Box, Typography, Card, CardContent, Grid, Button, Stack, Chip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CodeIcon from '@mui/icons-material/Code';
import DnsIcon from '@mui/icons-material/Dns';
import HttpsIcon from '@mui/icons-material/Https';
import { apiGet, apiPost } from '../../api/client.js';

interface OnboardingStatus {
  completed: boolean;
  steps: { code: boolean; infrastructure: boolean; ssl: boolean };
}

const STEPS = [
  {
    key: 'code' as const,
    icon: <CodeIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
    title: 'Connect Source Code',
    desc: 'Connect GitHub, GitLab, or Bitbucket to scan your repositories for vulnerabilities and secrets.',
    action: 'Connect Provider',
    link: '/integrations',
  },
  {
    key: 'infrastructure' as const,
    icon: <DnsIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
    title: 'Monitor Servers',
    desc: 'Install the agent on your servers or connect a cloud account (AWS, Azure, GCP, Proxmox) to discover infrastructure.',
    action: 'Set Up',
    link: '/infrastructure/coverage',
    secondaryAction: 'Copy Install Command',
  },
  {
    key: 'ssl' as const,
    icon: <HttpsIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
    title: 'Monitor Domains',
    desc: 'Add domains to monitor TLS certificates for expiration, weak keys, and chain issues.',
    action: 'Add Domains',
    link: '/monitoring/domains',
  },
];

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [copiedCmd, setCopiedCmd] = useState(false);

  const { data: envelope } = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => apiGet<OnboardingStatus>('/organizations/me/onboarding-status'),
  });
  const status = envelope?.data as OnboardingStatus | undefined;

  const completeMutation = useMutation({
    mutationFn: () => apiPost('/organizations/me/onboarding-complete', {}),
    onSuccess: () => navigate('/dashboard'),
  });

  const handleSkip = () => {
    completeMutation.mutate();
  };

  const handleCopyInstall = () => {
    navigator.clipboard.writeText('curl -fsSL https://install.securitycentral.io | bash -s -- --api-key YOUR_API_KEY --environment production');
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const allDone = status?.steps.code && status?.steps.infrastructure && status?.steps.ssl;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Box sx={{ maxWidth: 800, width: '100%' }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>Welcome to SecurityCentral</Typography>
          <Typography variant="body1" color="text.secondary">
            Let's set up your security monitoring in a few steps.
          </Typography>
        </Box>

        {/* Step Cards */}
        <Grid container spacing={2.5} sx={{ mb: 4 }}>
          {STEPS.map((step) => {
            const done = status?.steps[step.key] ?? false;
            return (
              <Grid item xs={12} md={4} key={step.key}>
                <Card sx={{
                  height: '100%',
                  border: done ? '2px solid' : '2px solid transparent',
                  borderColor: done ? 'success.main' : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                }}>
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: 3 }}>
                    <Box sx={{ mb: 1.5 }}>{step.icon}</Box>
                    <Typography variant="h6" sx={{ mb: 1 }}>{step.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5, flex: 1, mb: 2 }}>
                      {step.desc}
                    </Typography>

                    {done ? (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <CheckCircleIcon color="success" fontSize="small" />
                        <Typography variant="body2" color="success.main" sx={{ fontWeight: 500 }}>
                          Complete
                        </Typography>
                      </Stack>
                    ) : (
                      <Stack spacing={1}>
                        <Button variant="contained" fullWidth onClick={() => navigate(step.link)}>
                          {step.action}
                        </Button>
                        {step.key === 'infrastructure' && (
                          <Button
                            variant="outlined"
                            fullWidth
                            startIcon={copiedCmd ? <CheckIcon /> : <ContentCopyIcon />}
                            onClick={handleCopyInstall}
                          >
                            {copiedCmd ? 'Copied!' : 'Copy Install Command'}
                          </Button>
                        )}
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>

        {/* Footer */}
        <Box sx={{ textAlign: 'center' }}>
          {allDone ? (
            <Button
              variant="contained"
              color="success"
              size="large"
              endIcon={<ArrowForwardIcon />}
              onClick={() => completeMutation.mutate()}
            >
              Go to Dashboard
            </Button>
          ) : (
            <Button
              variant="text"
              color="inherit"
              onClick={handleSkip}
              disabled={completeMutation.isPending}
              sx={{ color: 'text.secondary' }}
            >
              {completeMutation.isPending ? 'Redirecting...' : 'Skip for now -- go to dashboard'}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
