import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Box,
  FormControlLabel, Checkbox, Select, MenuItem, FormControl,
  InputLabel, IconButton, Tabs, Tab, Alert, Chip, Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useCreateInstallToken } from '../api/hooks';

function getPlatformOrigin(): string {
  const raw = import.meta.env.VITE_API_URL ?? '';
  if (raw.startsWith('http')) {
    try { return new URL(raw).origin; } catch { /* fall through */ }
  }
  return 'http://localhost:3000';
}

const API_URL = getPlatformOrigin();

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId?: string;
}

export default function AddServerDialog({ open, onClose, projectId }: Props) {
  // Step 1: config
  const [tags, setTags] = useState<Record<string, string>>({});
  const [tagKey, setTagKey] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [scanPackages, setScanPackages] = useState(true);
  const [scanCompliance, setScanCompliance] = useState(true);
  const [scanInterval, setScanInterval] = useState('6h');

  // Step 2: token result
  const [step, setStep] = useState<1 | 2>(1);
  const [arch, setArch] = useState<'amd64' | 'arm64'>('amd64');
  const [copied, setCopied] = useState(false);
  const [expiresIn, setExpiresIn] = useState('');

  const createToken = useCreateInstallToken();

  useEffect(() => {
    if (!open) {
      setStep(1);
      setTags({});
      setTagKey('');
      setTagValue('');
      setScanPackages(true);
      setScanCompliance(true);
      setScanInterval('6h');
      setCopied(false);
      createToken.reset();
    }
  }, [open]);

  useEffect(() => {
    if (step !== 2 || !createToken.data?.data?.expiresAt) return;
    const update = () => {
      const diff = new Date(createToken.data!.data!.expiresAt).getTime() - Date.now();
      if (diff <= 0) { setExpiresIn('Expired'); return; }
      setExpiresIn(`${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [step, createToken.data]);

  const handleAddTag = useCallback(() => {
    const k = tagKey.trim();
    const v = tagValue.trim();
    if (k && v) {
      setTags((prev) => ({ ...prev, [k]: v }));
      setTagKey('');
      setTagValue('');
    }
  }, [tagKey, tagValue]);

  const handleRemoveTag = useCallback((key: string) => {
    setTags((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    createToken.mutate(
      {
        projectId,
        tags: Object.keys(tags).length > 0 ? tags : undefined,
        scan: { packages: scanPackages, compliance: scanCompliance, interval: scanInterval, onStartup: true },
        expiresInMinutes: 60,
      },
      { onSuccess: () => setStep(2) },
    );
  }, [projectId, tags, scanPackages, scanCompliance, scanInterval, createToken]);

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
            <Typography variant="subtitle2">Tags</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField size="small" placeholder="Key" value={tagKey} onChange={(e) => setTagKey(e.target.value)} sx={{ flex: 1 }} />
              <TextField size="small" placeholder="Value" value={tagValue} onChange={(e) => setTagValue(e.target.value)} sx={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
              />
              <Button size="small" variant="outlined" onClick={handleAddTag} disabled={!tagKey.trim() || !tagValue.trim()}>Add</Button>
            </Stack>
            {Object.keys(tags).length > 0 && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {Object.entries(tags).map(([k, v]) => (
                  <Chip key={k} label={`${k}: ${v}`} size="small" onDelete={() => handleRemoveTag(k)} />
                ))}
              </Stack>
            )}

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
                multiline fullWidth minRows={3} value={installCommand}
                slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
              <IconButton size="small" onClick={handleCopy} sx={{ position: 'absolute', top: 8, right: 8 }} title="Copy to clipboard">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Box>
            {copied && <Typography variant="caption" color="success.main">Copied to clipboard</Typography>}
            <Typography variant="body2" color="text.secondary">
              The agent binary handles everything: key generation, registration, certificate storage, config creation, and systemd service setup.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{step === 2 ? 'Done' : 'Cancel'}</Button>
        {step === 1 && (
          <Button variant="contained" onClick={handleGenerate} disabled={createToken.isPending}>
            {createToken.isPending ? 'Generating...' : 'Generate Install Command'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
