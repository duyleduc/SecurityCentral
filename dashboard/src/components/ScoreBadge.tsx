import { Box, Typography, Tooltip } from '@mui/material';

interface ScoreBadgeProps {
  score: number;
  breakdown?: Array<{ severity: string; count: number; deduction: number }>;
  grade?: string;
  size?: 'small' | 'medium' | 'large';
}

const SIZE_MAP = {
  small: { box: 36, font: '0.85rem', gradeFont: '0.6rem' },
  medium: { box: 48, font: '1.1rem', gradeFont: '0.65rem' },
  large: { box: 72, font: '1.75rem', gradeFont: '0.85rem' },
} as const;

function scoreColor(score: number): string {
  if (score >= 90) return '#16a34a';  // A — green
  if (score >= 80) return '#22c55e';  // B — light green
  if (score >= 70) return '#ea580c';  // C — orange
  if (score >= 60) return '#f59e0b';  // D — yellow/orange
  return '#dc2626';                    // F — red
}

export function scoreGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function formatBreakdown(breakdown: Array<{ severity: string; count: number; deduction: number }>): string {
  return breakdown
    .filter((b) => b.count > 0)
    .map((b) => `${b.severity.charAt(0).toUpperCase() + b.severity.slice(1)}: ${b.count} (−${b.deduction})`)
    .join(', ');
}

export function ScoreBadge({ score, breakdown, grade, size = 'medium' }: ScoreBadgeProps) {
  const { box, font, gradeFont } = SIZE_MAP[size];
  const color = scoreColor(score);
  const g = grade ?? scoreGrade(score);

  const badge = (
    <Box
      sx={{
        width: box,
        height: box,
        borderRadius: '50%',
        border: `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Typography sx={{ fontSize: font, fontWeight: 700, color, lineHeight: 1 }}>
        {g}
      </Typography>
      <Typography sx={{ fontSize: gradeFont, color, lineHeight: 1, mt: 0.15, opacity: 0.8 }}>
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

/**
 * Compute a security score (0–100) from severity counts.
 *
 * Uses capped deductions per severity tier so the score stays meaningful:
 *   - Critical: 8 pts each, max 35 deduction
 *   - High:     4 pts each, max 25 deduction
 *   - Medium:   1 pt each,  max 20 deduction
 *   - Low:      0.25 each,  max 10 deduction
 *
 * Score ranges → grades:
 *   A (90–100)  Excellent — no critical/high, few medium
 *   B (80–89)   Good — no critical, few high
 *   C (70–79)   Fair — some issues need attention
 *   D (60–69)   Poor — significant vulnerabilities
 *   F (0–59)    Critical — immediate action required
 */
export function computeScore(counts: { critical?: number; high?: number; medium?: number; low?: number; info?: number }): {
  score: number;
  grade: string;
  breakdown: Array<{ severity: string; count: number; deduction: number }>;
} {
  const tiers: Array<{ sev: string; perItem: number; cap: number }> = [
    { sev: 'critical', perItem: 8, cap: 35 },
    { sev: 'high',     perItem: 4, cap: 25 },
    { sev: 'medium',   perItem: 1, cap: 20 },
    { sev: 'low',      perItem: 0.25, cap: 10 },
  ];

  const breakdown: Array<{ severity: string; count: number; deduction: number }> = [];
  let total = 100;

  for (const { sev, perItem, cap } of tiers) {
    const count = (counts as Record<string, number | undefined>)[sev] ?? 0;
    const raw = count * perItem;
    const deduction = Math.min(raw, cap);
    breakdown.push({ severity: sev, count, deduction: Math.round(deduction) });
    total -= deduction;
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));
  return { score, grade: scoreGrade(score), breakdown };
}
