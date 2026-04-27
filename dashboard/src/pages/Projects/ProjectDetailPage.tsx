import { useState, useEffect, type KeyboardEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, Button, Chip, Stack, TextField,
  Tabs, Tab, Divider, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Snackbar,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import GitHubIcon from '@mui/icons-material/GitHub';
import CodeIcon from '@mui/icons-material/Code';
import { useProject, useUpdateProject, useDeleteProject } from '../../api/hooks';
import { SectionCard, SettingRow } from '../../components/design';

const COLOR_PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7'];

function colourFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id ?? '');
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const [tab, setTab] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [colorDraft, setColorDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState<Array<{ key: string; value: string }>>([]);
  const [tagInput, setTagInput] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  useEffect(() => {
    if (project) {
      setNameDraft(project.name);
      setDescriptionDraft(project.description ?? '');
      const detail = project as unknown as { notes?: string; banner?: string | null; tags?: Array<{ key: string; value: string }> };
      setNotesDraft(detail.notes ?? '');
      setColorDraft(detail.banner ?? colourFor(project.id));
      setTagsDraft(Array.isArray(detail.tags) ? detail.tags : []);
    }
  }, [project]);

  if (isLoading) return <Typography sx={{ p: 3 }}>Loading…</Typography>;
  if (!project) return <Typography sx={{ p: 3 }}>Project not found</Typography>;

  const detail = project as unknown as {
    id: string;
    name: string;
    description: string;
    notes: string;
    banner: string | null;
    createdAt: string;
    updatedAt: string;
    servers: Array<{ id: string; hostname: string; status: string }>;
    monitoredEndpoints: Array<{ id: string; host: string; status: string }>;
    repositories: Array<{ id: string; owner: string; name: string; provider: string; language: string | null; lastScanAt: string | null }>;
    tags?: Array<{ key: string; value: string }>;
    _count: { servers: number; monitoredEndpoints: number; repositories: number };
  };

  const fallbackColor = colourFor(detail.id);
  const persistedColor = detail.banner ?? fallbackColor;
  const colour = colorDraft || persistedColor;
  const persistedTags = Array.isArray(detail.tags) ? detail.tags : [];

  const tagsEqual = tagsDraft.length === persistedTags.length
    && tagsDraft.every((t, i) => t.key === persistedTags[i].key && t.value === persistedTags[i].value);

  const isDirty = nameDraft !== detail.name
    || descriptionDraft !== (detail.description ?? '')
    || notesDraft !== (detail.notes ?? '')
    || colorDraft !== persistedColor
    || !tagsEqual;

  const handleSave = () => {
    setErrorMsg(null);
    updateMutation.mutate({
      id: detail.id,
      name: nameDraft.trim(),
      description: descriptionDraft,
      notes: notesDraft,
      banner: colorDraft || null,
      tags: tagsDraft,
    }, {
      onSuccess: () => setSavedAt(new Date()),
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to save project';
        setErrorMsg(message);
      },
    });
  };

  const handleDiscard = () => {
    setNameDraft(detail.name);
    setDescriptionDraft(detail.description ?? '');
    setNotesDraft(detail.notes ?? '');
    setColorDraft(persistedColor);
    setTagsDraft(persistedTags);
    setTagInput('');
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    // Accept "key=value" or just "key" (value defaults to empty).
    const eqIdx = trimmed.indexOf('=');
    const key = (eqIdx === -1 ? trimmed : trimmed.slice(0, eqIdx)).trim();
    const value = eqIdx === -1 ? '' : trimmed.slice(eqIdx + 1).trim();
    if (!key) return;
    if (tagsDraft.some((t) => t.key === key && t.value === value)) {
      setTagInput('');
      return;
    }
    setTagsDraft([...tagsDraft, { key, value }]);
    setTagInput('');
  };

  const handleRemoveTag = (idx: number) => {
    setTagsDraft(tagsDraft.filter((_, i) => i !== idx));
  };

  const openDeleteDialog = () => {
    setDeleteConfirmName('');
    setErrorMsg(null);
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = () => {
    setErrorMsg(null);
    deleteMutation.mutate(detail.id, {
      onSuccess: () => {
        setConfirmDelete(false);
        navigate('/projects');
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to delete project';
        setErrorMsg(message);
      },
    });
  };

  // Ctrl/Cmd+S handler for save.
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (isDirty && !updateMutation.isPending) handleSave();
    }
  };

  return (
    <Box onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Breadcrumb */}
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
        <Typography
          onClick={() => navigate('/projects')}
          sx={{ fontSize: 12, color: 'text.disabled', cursor: 'pointer', '&:hover': { color: 'text.secondary' } }}
        >
          Projects
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>/</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{detail.name}</Typography>
      </Stack>

      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} mb={2}>
        <Box sx={{
          width: 56, height: 56, borderRadius: 1.5,
          background: `linear-gradient(135deg, ${colour}, ${colour}cc)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <FolderIcon sx={{ fontSize: 28, color: '#fff' }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: 26, fontWeight: 600 }}>{detail.name}</Typography>
            <Chip label="project" size="small" variant="outlined" />
            <Chip
              label={`created ${new Date(detail.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
              size="small" variant="outlined"
            />
          </Stack>
          <Typography sx={{ fontSize: 13, color: 'text.disabled', mt: 0.5 }}>
            Last edited {timeAgo(detail.updatedAt)}
          </Typography>
        </Box>
      </Stack>

      {/* At a glance summary strip */}
      <Card sx={{ mb: 2.5, p: '14px 20px' }}>
        <Stack direction="row" alignItems="center" spacing={4} flexWrap="wrap" useFlexGap>
          <Typography sx={{ fontSize: 11, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            At a glance
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            <strong>{detail._count.servers}</strong>{' '}
            <Typography component="span" sx={{ color: 'text.disabled', fontSize: 14 }}>servers</Typography>
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            <strong>{detail._count.monitoredEndpoints}</strong>{' '}
            <Typography component="span" sx={{ color: 'text.disabled', fontSize: 14 }}>domains</Typography>
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            <strong>{detail._count.repositories}</strong>{' '}
            <Typography component="span" sx={{ color: 'text.disabled', fontSize: 14 }}>repos</Typography>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small" variant="outlined" endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            onClick={() => navigate('/')}
          >
            Open scoped dashboard
          </Button>
        </Stack>
      </Card>

      <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1.5 }}>
        This page configures <em>how</em> the project behaves. For live data, scores, and findings, open the scoped dashboard.
      </Typography>

      {/* Tabs */}
      <Tabs
        value={tab} onChange={(_, v) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5,
          '& .MuiTab-root': { fontSize: 13, fontWeight: 500, textTransform: 'none', minHeight: 40 } }}
      >
        <Tab label="Settings" />
        <Tab label="Assets" />
        <Tab label="Alert rules" />
        <Tab label="Defaults & policies" />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={2}>
          {/* Section-wide save bar — sticky so it stays in view while scrolling
              between the Description, General, Inherited tags, and Danger zone cards. */}
          <Card sx={{
            position: 'sticky', top: 8, zIndex: 5,
            backdropFilter: 'blur(8px)',
            background: 'rgba(17, 26, 46, 0.85)',
            borderColor: isDirty ? 'rgba(99, 102, 241, 0.45)' : 'divider',
          }}>
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: isDirty ? 'text.primary' : 'text.secondary' }}>
                  {isDirty ? 'You have unsaved changes' : 'Settings'}
                </Typography>
                {savedAt && !isDirty && (
                  <Typography sx={{ fontSize: 12, color: 'success.main' }}>
                    ✓ saved {timeAgo(savedAt.toISOString())}
                  </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontSize: 11, color: 'text.disabled', mr: 0.5, display: { xs: 'none', sm: 'inline' } }}>
                  ⌘S
                </Typography>
                <Button size="small" variant="outlined" onClick={handleDiscard} disabled={!isDirty || updateMutation.isPending}>
                  Discard
                </Button>
                <Button size="small" variant="contained" onClick={handleSave}
                  disabled={!isDirty || updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </Stack>
            </CardContent>
          </Card>

          {/* Description card with prominent textarea (mockup .description-card) */}
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
                <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Description</Typography>
                <Stack direction="row" spacing={1} sx={{ fontSize: 11, color: 'text.disabled' }}>
                  <span>Markdown supported</span>
                  <span>·</span>
                  <span>{notesDraft.length} / 10,000 characters</span>
                </Stack>
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1.5 }}>
                Document what this project is, who owns it, on-call rotation, links to runbooks, compliance context — whatever your team needs to remember 6 months from now.
              </Typography>

              <TextField
                fullWidth multiline minRows={8} maxRows={20}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="## Production environment&#10;&#10;Customer-facing region. Owners: …"
                sx={{
                  '& .MuiInputBase-root': {
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13, lineHeight: 1.65,
                    background: 'rgba(15, 23, 42, 0.4)',
                  },
                }}
                slotProps={{ htmlInput: { maxLength: 10000 } }}
              />
            </CardContent>
          </Card>

          {/* General */}
          <SectionCard title="General">
            <SettingRow
              title="Name"
              description="Shown in the project switcher and every asset list."
              control={
                <TextField size="small" value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  sx={{ minWidth: 240 }} />
              }
            />
            <SettingRow
              title="Short description"
              description="One-line summary shown on the projects list page."
              control={
                <TextField size="small" value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder="e.g. Customer-facing production services"
                  sx={{ minWidth: 320 }} />
              }
            />
            <SettingRow
              title="Color"
              description="Shown next to the project name everywhere."
              control={
                <Stack direction="row" spacing={0.75}>
                  {COLOR_PALETTE.map((c) => (
                    <Box key={c}
                      onClick={() => setColorDraft(c)}
                      sx={{
                        width: 24, height: 24, borderRadius: 0.75, bgcolor: c,
                        cursor: 'pointer',
                        border: c === colorDraft ? '2px solid #fff' : '2px solid transparent',
                        transition: 'transform 0.1s',
                        '&:hover': { transform: 'scale(1.1)' },
                      }}
                    />
                  ))}
                </Stack>
              }
            />
          </SectionCard>

          {/* Inherited tags */}
          <SectionCard title="Inherited tags">
            <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1.5 }}>
              Free-form labels for this project. Format <code>key=value</code>.
              Click the × on any tag to remove it. Changes are saved with the rest of the section.
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap mb={1.25}>
              {tagsDraft.length === 0 && (
                <Typography sx={{ fontSize: 12, color: 'text.disabled', alignSelf: 'center' }}>
                  No tags yet.
                </Typography>
              )}
              {tagsDraft.map((t, i) => (
                <Chip
                  key={`${t.key}=${t.value}-${i}`}
                  label={t.value ? `${t.key}=${t.value}` : t.key}
                  size="small" variant="outlined"
                  onDelete={() => handleRemoveTag(i)}
                  sx={{ fontFamily: 'monospace', fontSize: 11 }}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small" placeholder="key=value" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                sx={{ minWidth: 240, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
              />
              <Button size="small" variant="outlined" onClick={handleAddTag} disabled={!tagInput.trim()}>
                Add tag
              </Button>
            </Stack>
          </SectionCard>

          {/* Danger zone */}
          <Card sx={{
            borderColor: 'rgba(239, 68, 68, 0.25)',
            background: 'rgba(239, 68, 68, 0.03)',
          }}>
            <CardContent>
              <Typography sx={{ fontSize: 15, fontWeight: 600, color: '#fca5a5', mb: 1 }}>
                Danger zone
              </Typography>
              <SettingRow
                title="Archive project"
                description="Hides it from navigation and stops all alerting. Assets continue to report but findings are frozen. Reversible."
                control={<Button size="small" variant="outlined" disabled>Archive</Button>}
              />
              <SettingRow
                title={<Box component="span" sx={{ color: '#fca5a5' }}>Delete project</Box>}
                description="Permanently deletes the project and unassigns all its assets (assets themselves are kept). This cannot be undone."
                control={
                  <Button size="small" variant="contained" color="error" onClick={openDeleteDialog}>
                    Delete project…
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          {/* Repositories */}
          <SectionCard title={`Repositories (${detail._count.repositories})`}>
            {detail.repositories.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No repositories linked.</Typography>
            ) : (
              <Stack divider={<Divider />}>
                {detail.repositories.map((r) => (
                  <Stack key={r.id} direction="row" alignItems="center" spacing={1.5}
                    onClick={() => navigate(`/repositories/${r.id}`)}
                    sx={{ py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                    {r.provider === 'github' ? <GitHubIcon fontSize="small" /> : <CodeIcon fontSize="small" />}
                    <Typography sx={{ flex: 1, fontSize: 13 }}>{r.owner}/{r.name}</Typography>
                    {r.language && <Chip label={r.language} size="small" variant="outlined" />}
                    <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                      {r.lastScanAt ? `Scanned ${new Date(r.lastScanAt).toLocaleDateString()}` : 'Never scanned'}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>

          {/* Servers */}
          <SectionCard title={`Servers (${detail._count.servers})`}>
            {detail.servers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No servers linked.</Typography>
            ) : (
              <Stack divider={<Divider />}>
                {detail.servers.map((s) => (
                  <Stack key={s.id} direction="row" alignItems="center" spacing={1.5}
                    onClick={() => navigate(`/servers/${s.id}`)}
                    sx={{ py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                    <StorageIcon fontSize="small" />
                    <Typography sx={{ flex: 1, fontSize: 13 }}>{s.hostname}</Typography>
                    <Chip label={s.status} size="small"
                      color={s.status === 'online' ? 'success' : s.status === 'warning' ? 'warning' : 'error'} />
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>

          {/* Domains */}
          <SectionCard title={`Domains (${detail._count.monitoredEndpoints})`}>
            {detail.monitoredEndpoints.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No domains linked.</Typography>
            ) : (
              <Stack divider={<Divider />}>
                {detail.monitoredEndpoints.map((e) => (
                  <Stack key={e.id} direction="row" alignItems="center" spacing={1.5}
                    onClick={() => navigate(`/domains/${e.id}`)}
                    sx={{ py: 1.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                    <DnsIcon fontSize="small" />
                    <Typography sx={{ flex: 1, fontSize: 13 }}>{e.host}</Typography>
                    <Chip label={e.status} size="small"
                      color={e.status === 'healthy' ? 'success' : e.status === 'degraded' ? 'warning' : 'error'} />
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Stack>
      )}

      {tab === 2 && (
        <Stack spacing={2}>
          <Alert severity="info">
            Project-scoped alert rules override the org-wide notification preferences for assets in <strong>{detail.name}</strong>.
            Until per-project rules ship, configure global preferences from <strong>Settings → Notifications</strong>.
          </Alert>
          <SectionCard
            title={
              <Stack direction="row" alignItems="center" spacing={1}>
                <span>Alert rules</span>
                <Chip label="project-scoped" size="small" variant="outlined" />
              </Stack>
            }
          >
            <SettingRow
              title={<>🔥 Critical findings on any asset <Chip label="always" size="small" color="error" sx={{ ml: 0.75 }} /></>}
              description="Fires when a new critical finding is opened. Delivery: email + Slack to org admins."
              control={<Chip label="org-wide default" size="small" variant="outlined" />}
            />
            <SettingRow
              title={<>🔒 SSL cert expiring <Chip label="30d / 14d / 7d / 1d" size="small" color="warning" sx={{ ml: 0.75 }} /></>}
              description="Four escalating reminders before expiry. Delivery: email."
              control={<Chip label="org-wide default" size="small" variant="outlined" />}
            />
            <SettingRow
              title={<>⚠ Server critical health <Chip label="15min debounce" size="small" variant="outlined" sx={{ ml: 0.75 }} /></>}
              description="CPU >85% or RAM >90% sustained. Delivery: email."
              control={<Chip label="org-wide default" size="small" variant="outlined" />}
            />
            <SettingRow
              title="🌙 Quiet hours"
              description="Currently using org-wide schedule (none configured)."
              control={<Button size="small" variant="outlined" disabled>Edit schedule</Button>}
            />
          </SectionCard>
        </Stack>
      )}

      <Dialog open={confirmDelete} onClose={() => !deleteMutation.isPending && setConfirmDelete(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ color: '#fca5a5' }}>Delete project</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This permanently deletes <strong>{detail.name}</strong>. The project's assets ({detail._count.servers} servers,
            {' '}{detail._count.monitoredEndpoints} domains, {detail._count.repositories} repos) will be unassigned but kept.
            This cannot be undone.
          </DialogContentText>
          <DialogContentText sx={{ mb: 1, fontSize: 13 }}>
            Type <code>{detail.name}</code> to confirm.
          </DialogContentText>
          <TextField
            fullWidth size="small" autoFocus
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={detail.name}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleteMutation.isPending}>Cancel</Button>
          <Button
            color="error" variant="contained"
            disabled={deleteConfirmName !== detail.name || deleteMutation.isPending}
            onClick={handleDeleteConfirm}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete project'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!errorMsg}
        autoHideDuration={6000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMsg(null)} variant="filled">
          {errorMsg}
        </Alert>
      </Snackbar>

      {tab === 3 && (
        <SectionCard title="Defaults applied to new assets">
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1.5 }}>
            Automatically applied the moment a new server, domain, or repo is added to <strong>{detail.name}</strong>.
          </Typography>
          <SettingRow
            title="Domain check interval"
            description="Default uptime polling cadence."
            control={<Chip label="15s" size="small" variant="outlined" />}
          />
          <SettingRow
            title="Required tags on assets"
            description="Asset creation is blocked unless these tag keys are set."
            control={
              <Stack direction="row" spacing={0.5}>
                <Chip label="tier" size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
                <Chip label="owner" size="small" variant="outlined" sx={{ fontFamily: 'monospace' }} />
              </Stack>
            }
          />
          <SettingRow
            title="Repo scan frequency"
            description="Full scan on push to default branch; delta on feature branches."
            control={
              <Stack direction="row" spacing={0.5}>
                <Chip label="on push" size="small" variant="outlined" />
                <Chip label="+ daily rescan" size="small" variant="outlined" />
              </Stack>
            }
          />
          <SettingRow
            title="Auto-dismiss info findings older than"
            description="Low-noise housekeeping for things nobody will ever act on."
            control={<Chip label="90 days" size="small" variant="outlined" />}
          />
        </SectionCard>
      )}
    </Box>
  );
}
