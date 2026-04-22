import { Chip, Tooltip } from '@mui/material';
import { WORK_STATE_LABELS, WORK_STATE_MUI_COLOR, type WorkState } from '../../lib/status';

interface WorkStateChipProps {
  readonly state: WorkState;
  readonly tooltip?: string;
  readonly size?: 'small' | 'medium';
  /** Prepend a state-indicating glyph (○, ◔, ●, ✕). Default true. */
  readonly withGlyph?: boolean;
}

const GLYPHS: Record<WorkState, string> = {
  new: '○',
  'in-progress': '◔',
  resolved: '●',
  dismissed: '✕',
};

const DESCRIPTIONS: Record<WorkState, string> = {
  new: 'Not yet triaged.',
  'in-progress': 'Someone is working on this.',
  resolved: 'Done.',
  dismissed: 'Closed without action (with a documented reason).',
};

export function WorkStateChip({ state, tooltip, size = 'small', withGlyph = true }: WorkStateChipProps) {
  const label = WORK_STATE_LABELS[state];
  const color = WORK_STATE_MUI_COLOR[state];
  const title = tooltip ?? DESCRIPTIONS[state];
  const displayLabel = withGlyph ? `${GLYPHS[state]} ${label}` : label;

  return (
    <Tooltip title={title} arrow>
      <Chip
        label={displayLabel}
        size={size}
        color={color}
        variant={state === 'in-progress' || state === 'resolved' ? 'filled' : 'outlined'}
        sx={{
          fontWeight: 500,
          textTransform: 'lowercase',
          '& .MuiChip-label': { px: 1.2 },
        }}
      />
    </Tooltip>
  );
}
