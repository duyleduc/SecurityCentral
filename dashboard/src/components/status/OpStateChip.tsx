import { Chip, Tooltip } from '@mui/material';
import { OP_STATE_LABELS, OP_STATE_MUI_COLOR, type OpState } from '../../lib/status';

interface OpStateChipProps {
  readonly state: OpState;
  readonly tooltip?: string;
  readonly size?: 'small' | 'medium';
}

const DESCRIPTIONS: Record<OpState, string> = {
  up: 'Actively reporting / responding to probes.',
  down: 'Not reachable / not reporting.',
};

export function OpStateChip({ state, tooltip, size = 'small' }: OpStateChipProps) {
  const label = OP_STATE_LABELS[state];
  const color = OP_STATE_MUI_COLOR[state];
  const title = tooltip ?? DESCRIPTIONS[state];
  const prefix = state === 'up' ? '●' : '○';

  return (
    <Tooltip title={title} arrow>
      <Chip
        label={`${prefix} ${label}`}
        size={size}
        color={color}
        variant="outlined"
        sx={{
          fontWeight: 500,
          textTransform: 'lowercase',
          '& .MuiChip-label': { px: 1.2 },
        }}
      />
    </Tooltip>
  );
}
