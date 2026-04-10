import { Box, Typography, Tooltip } from '@mui/material';

interface ScoreBadgeProps {
  score: number;
  breakdown?: Array<{ severity: string; count: number; deduction: number }>;
  size?: 'small' | 'medium' | 'large';
}

const SIZE_MAP = {
  small: { box: 36, font: '0.85rem' },
  medium: { box: 48, font: '1.1rem' },
  large: { box: 72, font: '1.75rem' },
} as const;

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 50) return '#ea580c';
  return '#dc2626';
}

function formatBreakdown(breakdown: Array<{ severity: string; count: number; deduction: number }>): string {
  return breakdown
    .filter((b) => b.count > 0)
    .map((b) => `${b.severity.charAt(0).toUpperCase() + b.severity.slice(1)}: ${b.count} (-${b.deduction})`)
    .join(', ');
}

export function ScoreBadge({ score, breakdown, size = 'medium' }: ScoreBadgeProps) {
  const { box, font } = SIZE_MAP[size];
  const color = scoreColor(score);

  const badge = (
    <Box
      sx={{
        width: box,
        height: box,
        borderRadius: '50%',
        border: `3px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Typography sx={{ fontSize: font, fontWeight: 700, color, lineHeight: 1 }}>
        {score}
      </Typography>
    </Box>
  );

  if (breakdown && breakdown.length > 0) {
    const tip = formatBreakdown(breakdown);
    if (tip) {
      return <Tooltip title={tip} arrow>{badge}</Tooltip>;
    }
  }

  return badge;
}

/** Compute a security score client-side from severity counts. */
export function computeScore(counts: { critical?: number; high?: number; medium?: number; low?: number; info?: number }): {
  score: number;
  breakdown: Array<{ severity: string; count: number; deduction: number }>;
} {
  const weights: Record<string, number> = { critical: 25, high: 15, medium: 5, low: 2, info: 0 };
  const breakdown: Array<{ severity: string; count: number; deduction: number }> = [];
  let total = 100;

  for (const [sev, weight] of Object.entries(weights)) {
    const count = (counts as Record<string, number | undefined>)[sev] ?? 0;
    const deduction = count * weight;
    breakdown.push({ severity: sev, count, deduction });
    total -= deduction;
  }

  return { score: Math.max(0, Math.min(100, total)), breakdown };
}
