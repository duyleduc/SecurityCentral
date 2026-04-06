import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0f766e', light: '#2dd4bf', dark: '#0f4c47' },
    secondary: { main: '#f97316', light: '#fdba74', dark: '#c2410c' },
    error: { main: '#dc2626' },
    warning: { main: '#f59e0b' },
    success: { main: '#16a34a' },
    info: { main: '#0ea5e9' },
    background: { default: '#f6f4ef', paper: '#ffffff' },
    text: { primary: '#0b1320', secondary: '#52607a' },
  },
  typography: {
    fontFamily: '"Sora", "Segoe UI", system-ui, -apple-system, sans-serif',
    h4: { fontWeight: 700, fontSize: '1.8rem', letterSpacing: '-0.02em' },
    h5: { fontWeight: 600, fontSize: '1.3rem', letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, fontSize: '1.05rem' },
    subtitle2: { fontWeight: 500, color: '#52607a' },
    body2: { color: '#3d4b66' },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 8 },
      },
      defaultProps: { disableElevation: true },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 14, boxShadow: '0 10px 30px rgba(13, 38, 76, 0.08), 0 2px 6px rgba(13, 38, 76, 0.06)' },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600, fontSize: '0.75rem' } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { border: 'none' } },
    },
  },
});

// Severity color map used across the app
export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  info: '#64748b',
};

export const SEVERITY_BG: Record<string, string> = {
  critical: '#fef2f2',
  high: '#fff7ed',
  medium: '#fefce8',
  low: '#eff6ff',
  info: '#f8fafc',
};

export const STATUS_COLORS: Record<string, string> = {
  open: '#dc2626',
  in_progress: '#f59e0b',
  resolved: '#16a34a',
  suppressed: '#64748b',
  false_positive: '#64748b',
};

export const DRAWER_WIDTH = 260;
