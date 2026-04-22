import { Chip, Tooltip, Box } from '@mui/material';
import { HEALTH_LABELS, HEALTH_MUI_COLOR, type Health } from '../../lib/status';

interface HealthChipProps {
  readonly health: Health;
  /** When true, renders a dense version without the label (dot only). */
  readonly dense?: boolean;
  /** Optional tooltip override; default is the health label + short description. */
  readonly tooltip?: string;
  readonly size?: 'small' | 'medium';
}

const DESCRIPTIONS: Record<Health, string> = {
  healthy: 'All checks passing.',
  'at-risk': 'Degradation detected — investigate when possible.',
  critical: 'Immediate attention required.',
  unknown: 'No recent signal — agent offline or never reported.',
};

export function HealthChip({ health, dense, tooltip, size = 'small' }: HealthChipProps) {
  const label = HEALTH_LABELS[health];
  const color = HEALTH_MUI_COLOR[health];
  const title = tooltip ?? `${label} — ${DESCRIPTIONS[health]}`;

  if (dense) {
    return (
      <Tooltip title={title} arrow>
        <Box
          component="span"
          role="img"
          aria-label={label}
          sx={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: (t) => (color === 'default' ? t.palette.action.disabled : t.palette[color].main),
          }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={title} arrow>
      <Chip
        label={label}
        size={size}
        color={color}
        variant="filled"
        sx={{
          fontWeight: 600,
          textTransform: 'lowercase',
          // Soft background even on filled — closer to the mockup.
          bgcolor: (t) =>
            color === 'default'
              ? t.palette.action.selected
              : `${t.palette[color].main}22`,
          color: (t) => (color === 'default' ? t.palette.text.secondary : t.palette[color].light),
          '& .MuiChip-label': { px: 1.2 },
        }}
      />
    </Tooltip>
  );
}
