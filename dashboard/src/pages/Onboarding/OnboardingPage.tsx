import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Stepper, Step, StepLabel, Button, Card, CardContent,
  TextField, Stack, Alert, Paper,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import {
  useCreateProject, useCreateEndpoint, useCreateInstallToken,
} from '../../api/hooks';

const STEPS = ['Create Project', 'Add Domain', 'Install Agent'];

export function OnboardingPage() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  // Step 1: Project
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const createProject = useCreateProject();

  // Step 2: Domain
  const [domainHost, setDomainHost] = useState('');
  const createEndpoint = useCreateEndpoint();

  // Step 3: Agent
  const [installCommand, setInstallCommand] = useState('');
  const createToken = useCreateInstallToken();

  const handleCreateProject = async () => {
    const result = await createProject.mutateAsync({ name: projectName });
    setProjectId(result.id);
    setActiveStep(1);
  };

  const handleAddDomain = async () => {
    await createEndpoint.mutateAsync({
      host: domainHost,
      port: 443,
      protocol: 'https',
      projectId: projectId ?? undefined,
    });
    setActiveStep(2);
  };

  const handleGenerateToken = async () => {
    const result = await createToken.mutateAsync({
      label: `${projectName} agent`,
      projectId: projectId ?? undefined,
    });
    setInstallCommand(
      `curl -fsSL https://get.securitycentral.io/install.sh | bash -s -- --token ${result.rawToken} --api-url ${window.location.origin}`,
    );
  };

  const handleFinish = () => {
    navigate('/');
  };

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', py: 4 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 4 }}>
        <RocketLaunchIcon sx={{ fontSize: 36, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" fontWeight={700}>Welcome to SecurityCentral</Typography>
          <Typography variant="body2" color="text.secondary">Let's set up your security monitoring in 3 steps.</Typography>
        </Box>
      </Stack>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 1: Create Project */}
      {activeStep === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Create your first project</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Projects group related assets together — domains, servers, and repositories.
            </Typography>
            <TextField
              fullWidth
              label="Project Name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Production, Staging, My SaaS"
              sx={{ mb: 2 }}
            />
            <Button
              variant="contained"
              onClick={handleCreateProject}
              disabled={!projectName || createProject.isPending}
            >
              {createProject.isPending ? 'Creating...' : 'Create Project'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Add Domain */}
      {activeStep === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Add a domain to monitor</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              We'll check SSL certificates, DNS security (SPF/DKIM/DMARC), and uptime.
            </Typography>
            <TextField
              fullWidth
              label="Domain"
              value={domainHost}
              onChange={(e) => setDomainHost(e.target.value)}
              placeholder="e.g. example.com"
              sx={{ mb: 2 }}
            />
            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={handleAddDomain}
                disabled={!domainHost || createEndpoint.isPending}
              >
                {createEndpoint.isPending ? 'Adding...' : 'Add Domain'}
              </Button>
              <Button variant="text" onClick={() => setActiveStep(2)}>Skip</Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Install Agent */}
      {activeStep === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Install the monitoring agent</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Install sc-agent on your server to monitor CPU, RAM, disk, and security posture.
            </Typography>

            {!installCommand ? (
              <Stack direction="row" spacing={2}>
                <Button variant="contained" onClick={handleGenerateToken} disabled={createToken.isPending}>
                  {createToken.isPending ? 'Generating...' : 'Generate Install Command'}
                </Button>
                <Button variant="text" onClick={handleFinish}>Skip</Button>
              </Stack>
            ) : (
              <Box>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Run this command on the server you want to monitor:
                </Alert>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: '#1e1e1e', borderRadius: 1, mb: 3 }}>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#e5e7eb', wordBreak: 'break-all' }}>
                    {installCommand}
                  </Typography>
                </Paper>
                <Button variant="contained" onClick={handleFinish}>
                  Finish Setup
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
