import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Chip,
  Stack,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  IconButton,
  TextField,
  MenuItem,
  CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import FolderIcon from '@mui/icons-material/Folder';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AssessmentIcon from '@mui/icons-material/Assessment';
import InsightsIcon from '@mui/icons-material/Insights';
import SecurityIcon from '@mui/icons-material/Security';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  useDeleteServer,
  useUpdateServer,
  useProjects,
  useAgentLatestVersion,
  useScoreHistory,
  useSecurityPosture,
  useServerVulnerabilities,
  type Server,
} from '../../api/hooks';
import { ScoreBadge, computeScore } from '../../components/ScoreBadge';
import { TagsInput, type Tag } from '../../components/TagsInput';
import { HealthChip, OpStateChip } from '../../components/status';
import { healthFromServerStatus, opStateFromServerStatus } from '../../lib/status';

export type ServerTab = 'monitoring' | 'security';

interface ServerHeaderProps {
  server: Server;
  activeTab: ServerTab;
}

export function ServerHeader({ server, activeTab }: ServerHeaderProps) {
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: posture } = useSecurityPosture(server.id);
  const { data: vulns } = useServerVulnerabilities(server.id);
  const { data: projects } = useProjects();
  const { data: latestAgent } = useAgentLatestVersion();
  const { data: scoreHistory } = useScoreHistory(server.id);
  const deleteMutation = useDeleteServer();
  const updateMutation = useUpdateServer();

  const serverScore = (() => {
    const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const v of vulns ?? []) {
      if (sevCounts[v.severity] !== undefined) sevCounts[v.severity]++;
    }
    const audits = posture?.auditResults ?? [];
    for (const a of audits) {
      if (a.status === 'fail' && sevCounts[a.severity] !== undefined) sevCounts[a.severity]++;
    }
    if (posture && !posture.firewallActive) sevCounts.high++;
    return computeScore(sevCounts);
  })();

  const handleTabChange = (_: unknown, value: ServerTab) => {
    navigate(`/servers/${server.id}/${value}`);
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/servers')}>
          Back to Servers
        </Button>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<AssessmentIcon />}
            variant="contained"
            size="small"
            onClick={() => navigate(`/servers/${server.id}/report`)}
          >
            Full Report
          </Button>
          <Button
            startIcon={<EditIcon />}
            variant="outlined"
            size="small"
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
          <Button
            startIcon={<DeleteIcon />}
            color="error"
            variant={server.status === 'dead' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setDeleteOpen(true)}
          >
            {server.status === 'dead' ? 'Delete Server' : 'Delete'}
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Stack alignItems="center" spacing={0.5}>
          <ScoreBadge score={server.securityScore ?? serverScore.score} breakdown={serverScore.breakdown} size="medium" />
          {scoreHistory && scoreHistory.length > 1 && (
            <Box sx={{ width: 48, height: 20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreHistory.map((h) => ({ s: h.score }))} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="s" stroke="#6366f1" strokeWidth={1.5} fill="url(#sparkGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Stack>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h4">{server.hostname}</Typography>
            <HealthChip health={healthFromServerStatus(server.status)} />
            <OpStateChip state={opStateFromServerStatus(server.status)} />
            {server.project && (
              <Chip icon={<FolderIcon sx={{ fontSize: 14 }} />} label={server.project.name} size="small" variant="outlined"
                onClick={() => navigate(`/projects/${server.project!.id}`)} />
            )}
            {server.agentVersion && <Chip label={`Agent v${server.agentVersion}`} variant="outlined" size="small" />}
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
            {serverScore.breakdown.filter((b) => b.count > 0).map((b) => (
              <Chip key={b.severity} size="small" variant="outlined"
                label={`${b.count} ${b.severity} (−${b.deduction})`}
                color={b.severity === 'critical' ? 'error' : b.severity === 'high' ? 'warning' : b.severity === 'medium' ? 'info' : 'default'}
                sx={{ fontSize: '0.7rem', height: 22 }} />
            ))}
            {serverScore.breakdown.every((b) => b.count === 0) && (
              <Chip size="small" label="No issues" color="success" variant="outlined" sx={{ fontSize: '0.7rem', height: 22 }} />
            )}
          </Stack>
          {server.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              {server.tags.map((t) => (
                <Chip
                  key={t.key}
                  label={t.value ? `${t.key}: ${t.value}` : t.key}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem', borderColor: 'primary.dark' }}
                />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>

      {server.agentVersion && latestAgent?.version && server.agentVersion !== latestAgent.version && server.agentVersion !== 'dev' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Agent update available: <strong>v{latestAgent.version}</strong> (current: v{server.agentVersion}).
          Run on the server: <code style={{ marginLeft: 4, padding: '2px 6px', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.2)' }}>sudo sc-agent update</code>
        </Alert>
      )}

      {(server.status === 'offline' || server.status === 'dead') && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Server is {server.status}
          {server.lastHeartbeat
            ? ` — last heartbeat ${new Date(server.lastHeartbeat).toLocaleString()}`
            : ''}
          . Showing last available historical data.
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab value="monitoring" icon={<InsightsIcon fontSize="small" />} iconPosition="start" label="Monitoring" />
          <Tab value="security" icon={<SecurityIcon fontSize="small" />} iconPosition="start" label="Security" />
        </Tabs>
      </Box>

      <DeleteServerDialog
        open={deleteOpen}
        hostname={server.hostname}
        loading={deleteMutation.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          deleteMutation.mutate(server.id, {
            onSuccess: () => navigate('/servers'),
          });
        }}
        copied={copied}
        onCopy={() => {
          navigator.clipboard.writeText(UNINSTALL_CMD);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      />

      <EditServerDialog
        open={editOpen}
        server={server}
        projects={projects ?? []}
        loading={updateMutation.isPending}
        onClose={() => setEditOpen(false)}
        onSave={(data) => {
          updateMutation.mutate({ id: server.id, ...data }, {
            onSuccess: () => setEditOpen(false),
          });
        }}
      />
    </Box>
  );
}

interface EditServerDialogProps {
  open: boolean;
  server: { hostname: string; projectId: string | null; tags: Array<{ key: string; value: string }> };
  projects: Array<{ id: string; name: string }>;
  loading: boolean;
  onClose: () => void;
  onSave: (data: { hostname?: string; projectId?: string | null; tags?: Array<{ key: string; value: string }> }) => void;
}

function EditServerDialog({ open, server, projects, loading, onClose, onSave }: EditServerDialogProps) {
  const [hostname, setHostname] = useState(server.hostname);
  const [projectId, setProjectId] = useState(server.projectId ?? '');
  const [tags, setTags] = useState<Tag[]>(server.tags);

  const handleEnter = () => {
    setHostname(server.hostname);
    setProjectId(server.projectId ?? '');
    setTags(server.tags);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth TransitionProps={{ onEnter: handleEnter }}>
      <DialogTitle>Edit Server</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            fullWidth size="small"
            label="Hostname"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
          />
          <TextField
            fullWidth size="small" select
            label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <MenuItem value="">No project</MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </TextField>
          <TagsInput tags={tags} onChange={setTags} existingKeys={[]} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          disabled={loading || !hostname.trim()}
          onClick={() => onSave({
            hostname: hostname.trim(),
            projectId: projectId || null,
            tags,
          })}
        >
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const UNINSTALL_CMD = `sudo systemctl stop sc-agent
sudo systemctl disable sc-agent
sudo rm -f /etc/systemd/system/sc-agent.service
sudo systemctl daemon-reload
sudo rm -f /usr/local/bin/sc-agent
sudo rm -rf /etc/securitycentral`;

interface DeleteServerDialogProps {
  open: boolean;
  hostname: string;
  loading: boolean;
  copied: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCopy: () => void;
}

function DeleteServerDialog({ open, hostname, loading, copied, onClose, onConfirm, onCopy }: DeleteServerDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: 'error.main' }}>Delete Server: {hostname}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will permanently delete the server, all metric history, security posture data, and related findings.
          The agent will be instructed to shut down on its next heartbeat.
        </Alert>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          To fully remove the agent from the server, run these commands via SSH:
        </Typography>
        <Box sx={{
          position: 'relative',
          bgcolor: '#0f172a',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          p: 2,
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          lineHeight: 1.8,
          whiteSpace: 'pre',
          overflow: 'auto',
        }}>
          <IconButton
            size="small"
            onClick={onCopy}
            sx={{ position: 'absolute', top: 4, right: 4 }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          {copied && (
            <Typography variant="caption" sx={{ position: 'absolute', top: 8, right: 40, color: 'success.main' }}>
              Copied
            </Typography>
          )}
          {UNINSTALL_CMD}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <DeleteIcon />}
        >
          {loading ? 'Deleting...' : 'Delete Server'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
