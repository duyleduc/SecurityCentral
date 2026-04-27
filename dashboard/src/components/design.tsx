/**
 * Design primitives matching docs/mockups/c-*.html ("Option C").
 * These keep the look-and-feel consistent across pages.
 */

import { Box, Card, CardContent, Typography, Stack } from '@mui/material';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// ScoreRing — conic-gradient circular score (mockup .score-ring)
// ---------------------------------------------------------------------------

interface ScoreRingProps {
  score: number;        // 0–100
  size?: number;        // px (default 72)
  bg?: string;          // background filling the inner cutout
}

export function ScoreRing({ score, size = 72, bg = '#111a2e' }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = clamped >= 80 ? '#22c55e' : clamped >= 60 ? '#f59e0b' : '#ef4444';
  const innerInset = Math.max(4, Math.round(size * 0.083));

  return (
    <Box
      sx={{
        width: size, height: size, borderRadius: '50%',
        background: `conic-gradient(${color} 0 ${clamped}%, rgba(148, 163, 184, 0.15) ${clamped}% 100%)`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', flexShrink: 0,
        '&::before': {
          content: '""', position: 'absolute',
          inset: `${innerInset}px`,
          borderRadius: '50%', background: bg,
        },
      }}
    >
      <Typography sx={{ position: 'relative', fontSize: size * 0.28, fontWeight: 700 }}>
        {clamped}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// StatCard — large number tile with click-through (mockup .stat-card)
// ---------------------------------------------------------------------------

interface StatCardProps {
  value: number | string;
  label: string;
  color?: 'success' | 'warning' | 'error' | 'info' | 'muted';
  active?: boolean;       // when true, draws coloured border (filter-on indicator)
  onClick?: () => void;
}

export function StatCard({ value, label, color = 'muted', active, onClick }: StatCardProps) {
  const numColor = {
    success: '#22c55e',
    warning: '#f59e0b',
    error:   '#ef4444',
    info:    '#22d3ee',
    muted:   '#94a3b8',
  }[color];

  const borderColor = active
    ? color === 'success' ? 'rgba(34, 197, 94, 0.4)'
    : color === 'warning' ? 'rgba(245, 158, 11, 0.4)'
    : color === 'error'   ? 'rgba(239, 68, 68, 0.4)'
    : color === 'info'    ? 'rgba(34, 211, 238, 0.4)'
    : 'rgba(148, 163, 184, 0.3)'
    : 'transparent';

  return (
    <Card
      onClick={onClick}
      sx={{
        flex: 1, minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        border: '2px solid', borderColor,
        transition: 'border-color 0.15s',
        '&:hover': onClick ? { borderColor: 'rgba(148, 163, 184, 0.3)' } : undefined,
      }}
    >
      <CardContent sx={{ py: 1.75, px: 2.25, '&:last-child': { pb: 1.75 } }}>
        <Typography sx={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, color: numColor }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SectionCard — card with sticky uppercase header (mockup .card with h3)
// ---------------------------------------------------------------------------

interface SectionCardProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  accent?: 'critical' | 'warning' | 'primary';
}

export function SectionCard({ title, action, children, accent }: SectionCardProps) {
  const accentBg = accent === 'critical' ? 'rgba(239, 68, 68, 0.06)'
    : accent === 'warning' ? 'rgba(245, 158, 11, 0.05)'
    : accent === 'primary' ? 'rgba(99, 102, 241, 0.05)' : undefined;
  const accentBorder = accent === 'critical' ? 'rgba(239, 68, 68, 0.35)'
    : accent === 'warning' ? 'rgba(245, 158, 11, 0.35)'
    : accent === 'primary' ? 'rgba(99, 102, 241, 0.35)' : undefined;

  return (
    <Card sx={accentBg ? { background: accentBg, borderColor: accentBorder } : undefined}>
      <CardContent>
        {(title || action) && (
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            {title && (
              <Typography sx={{
                fontSize: 15, fontWeight: 600, color: 'text.secondary',
              }}>
                {title}
              </Typography>
            )}
            {action}
          </Stack>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AlertRow — colored icon tile + title + sub (mockup .alert-row)
// ---------------------------------------------------------------------------

interface AlertRowProps {
  icon: ReactNode;
  iconColor: 'critical' | 'warning' | 'info' | 'primary';
  title: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
}

export function AlertRow({ icon, iconColor, title, sub, onClick }: AlertRowProps) {
  const bg = iconColor === 'critical' ? 'rgba(239, 68, 68, 0.15)'
    : iconColor === 'warning' ? 'rgba(245, 158, 11, 0.15)'
    : iconColor === 'info' ? 'rgba(34, 211, 238, 0.15)'
    : 'rgba(99, 102, 241, 0.18)';
  const fg = iconColor === 'critical' ? '#fca5a5'
    : iconColor === 'warning' ? '#fcd34d'
    : iconColor === 'info' ? '#67e8f9'
    : '#a5b4fc';

  return (
    <Stack
      direction="row" alignItems="center" spacing={1.5}
      onClick={onClick}
      sx={{
        py: 1.25, borderBottom: '1px solid', borderColor: 'divider',
        cursor: onClick ? 'pointer' : 'default',
        '&:last-child': { borderBottom: 'none' },
        '&:hover': onClick ? { background: 'rgba(148, 163, 184, 0.04)' } : undefined,
      }}
    >
      <Box sx={{
        width: 28, height: 28, borderRadius: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: bg, color: fg, flexShrink: 0,
      }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{title}</Typography>
        {sub && <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
      </Box>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// SettingRow — label + description + control (mockup .setting-row)
// ---------------------------------------------------------------------------

interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}

export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={2.5}
      sx={{
        py: 1.75, borderBottom: '1px solid', borderColor: 'divider',
        '&:last-child': { borderBottom: 'none' },
      }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{title}</Typography>
        {description && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25, lineHeight: 1.5 }}>
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0 }}>{control}</Box>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// StatusDot — small coloured dot for severity/state chips
// ---------------------------------------------------------------------------

interface StatusDotProps {
  color: 'success' | 'warning' | 'error' | 'info' | 'muted';
  size?: number;
}

export function StatusDot({ color, size = 8 }: StatusDotProps) {
  const bg = {
    success: '#22c55e',
    warning: '#f59e0b',
    error:   '#ef4444',
    info:    '#22d3ee',
    muted:   '#94a3b8',
  }[color];
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', bgcolor: bg, flexShrink: 0,
      display: 'inline-block',
    }} />
  );
}
