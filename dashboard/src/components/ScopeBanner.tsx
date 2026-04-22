import { Box, Typography, Link } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import { useProjectScope } from '../lib/useProjectScope';
import { useProjects } from '../api/hooks';

interface ScopeBannerProps {
  /** Optional per-type counts to render inline. */
  readonly counts?: { servers?: number; domains?: number; repos?: number; items?: number };
  /** Custom label to use instead of the asset-type summary. E.g., "12 endpoints in scope". */
  readonly summary?: string;
}

/**
 * Renders only when a specific project is selected via the top-bar switcher.
 * Reminds the user what's scoped and offers a one-click escape back to "All projects".
 */
export function ScopeBanner({ counts, summary }: ScopeBannerProps) {
  const { projectId, setProject } = useProjectScope();
  const { data: projects } = useProjects();

  if (!projectId) return null;

  const project = projects?.find((p) => p.id === projectId);
  const projectName = project?.name ?? 'this project';

  const summaryText =
    summary ??
    [
      counts?.servers != null ? `${counts.servers} servers` : null,
      counts?.domains != null ? `${counts.domains} domains` : null,
      counts?.repos != null ? `${counts.repos} repos` : null,
      counts?.items != null ? `${counts.items} items` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        mb: 2,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'primary.dark',
        bgcolor: (t) => `${t.palette.primary.main}11`,
        fontSize: 13,
      }}
    >
      <FolderIcon sx={{ fontSize: 16, color: 'primary.light' }} />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Scope: <Box component="strong" sx={{ color: 'primary.light' }}>{projectName}</Box>
        {summaryText ? ` · ${summaryText}` : ''}
      </Typography>
      <Link
        component="button"
        type="button"
        onClick={() => setProject(null)}
        sx={{ ml: 'auto', fontSize: 12, cursor: 'pointer' }}
      >
        View all projects
      </Link>
    </Box>
  );
}
