import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Box, RadioGroup, Radio,
  FormControlLabel, Checkbox, Select, MenuItem, FormControl,
  InputLabel, IconButton, Tabs, Tab, Alert,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useCreateInstallToken } from '../api/hooks';

// Derive the platform API origin for the install command.
// VITE_API_URL is something like "https://sc-api-xxx.run.app/api/v1" or "/api/v1" (local).
// We need the origin (e.g. "https://sc-api-xxx.run.app" or "http://localhost:3000").
function getPlatformOrigin(): string {
  const raw = import.meta.env.VITE_API_URL ?? '';
  // If it's a full URL, strip the path
  if (raw.startsWith('http')) {
    try { return new URL(raw).origin; } catch { /* fall through */ }
  }
  // Local dev: use the API port (Vite proxies /api, but agent needs direct access)
  return 'http://localhost:3000';
}

const API_URL = getPlatformOrigin();

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export default function AddServerDialog({ open, onClose }: Props) {
  // Step 1: config
  const [environment, setEnvironment] = useState('production');
  const [scanPackages, setScanPackages] = useState(true);
  const [scanCompliance, setScanCompliance] = useState(true);
  const [scanInterval, setScanInterval] = useState('6h');

  // Step 2: token result
  const [step, setStep] = useState<1 | 2>(1);
  const [arch, setArch] = useState<'amd64' | 'arm64'>('amd64');
  const [copied, setCopied] = useState(false);
  const [expiresIn, setExpiresIn] = useState('');

  const createToken = useCreateInstallToken();

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep(1);
      setEnvironment('production');
      setScanPackages(true);
      setScanCompliance(true);
      setScanInterval('6h');
      setCopied(false);
      createToken.reset();
    }
  }, [open]);

  // Expiry countdown
  useEffect(() => {
    if (step !== 2 || !createToken.data?.data?.expiresAt) return;

    const update = () => {
      const diff = new Date(createToken.data!.data!.expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setExpiresIn('Expired');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setExpiresIn(`${mins}m ${secs}s`);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [step, createToken.data]);

  const handleGenerate = useCallback(() => {
    createToken.mutate(
      {
        environment,
        scan: {
          packages: scanPackages,
          compliance: scanCompliance,
          interval: scanInterval,
          onStartup: true,
        },
        expiresInMinutes: 60,
      },
      { onSuccess: () => setStep(2) },
    );
  }, [environment, scanPackages, scanCompliance, scanInterval, createToken]);

  const token = createToken.data?.data?.token ?? '';
  const downloadUrl = `${API_URL}/v1/agents/download?arch=${arch}`;
  const installCommand = [
    `curl -fsSL -o sc-agent ${downloadUrl}`,
    `chmod +x sc-agent && sudo ./sc-agent install --token ${token} --api-url ${API_URL}`,
  ].join('\n');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [installCommand]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Server</DialogTitle>
      <DialogContent>
        {step === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Typography variant="subtitle2">Environment</Typography>
            <RadioGroup
              row
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              <FormControlLabel value="production" control={<Radio size="small" />} label="Production" />
              <FormControlLabel value="staging" control={<Radio size="small" />} label="Staging" />
              <FormControlLabel value="development" control={<Radio size="small" />} label="Development" />
            </RadioGroup>

            <Typography variant="subtitle2">Scan Settings</Typography>
            <FormControlLabel
              control={<Checkbox checked={scanPackages} onChange={(e) => setScanPackages(e.target.checked)} size="small" />}
              label="OS package vulnerability scanning"
            />
            <FormControlLabel
              control={<Checkbox checked={scanCompliance} onChange={(e) => setScanCompliance(e.target.checked)} size="small" />}
              label="CIS compliance benchmarks"
            />

            <FormControl size="small" sx={{ maxWidth: 200 }}>
              <InputLabel>Scan Interval</InputLabel>
              <Select value={scanInterval} label="Scan Interval" onChange={(e) => setScanInterval(e.target.value)}>
                <MenuItem value="1h">Every hour</MenuItem>
                <MenuItem value="6h">Every 6 hours</MenuItem>
                <MenuItem value="12h">Every 12 hours</MenuItem>
                <MenuItem value="24h">Every 24 hours</MenuItem>
              </Select>
            </FormControl>

            {createToken.isError && (
              <Alert severity="error">Failed to create install token. Please try again.</Alert>
            )}
          </Box>
        )}

        {step === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Alert severity="info">
              Run this command on the target server. Token expires in <strong>{expiresIn}</strong>.
            </Alert>

            <Tabs value={arch} onChange={(_, v) => setArch(v)} sx={{ minHeight: 36 }}>
              <Tab label="Linux amd64" value="amd64" sx={{ minHeight: 36, py: 0 }} />
              <Tab label="Linux arm64" value="arm64" sx={{ minHeight: 36, py: 0 }} />
            </Tabs>

            <Box sx={{ position: 'relative' }}>
              <TextField
                multiline
                fullWidth
                minRows={3}
                value={installCommand}
                slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
              <IconButton
                size="small"
                onClick={handleCopy}
                sx={{ position: 'absolute', top: 8, right: 8 }}
                title="Copy to clipboard"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>

            {copied && (
              <Typography variant="caption" color="success.main">Copied to clipboard</Typography>
            )}

            <Typography variant="body2" color="text.secondary">
              The agent binary handles everything: key generation, registration, certificate storage, config creation, and systemd service setup.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {step === 2 ? 'Done' : 'Cancel'}
        </Button>
        {step === 1 && (
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={createToken.isPending}
          >
            {createToken.isPending ? 'Generating...' : 'Generate Install Command'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
