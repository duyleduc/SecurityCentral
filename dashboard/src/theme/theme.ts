import { createTheme, alpha } from '@mui/material/styles';

// Aligned with docs/mockups/shared.css ("Option C")
export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#6366f1', dark: '#4f46e5' },
    secondary: { main: '#22d3ee' },
    error: { main: '#ef4444' },
    warning: { main: '#f59e0b' },
    success: { main: '#22c55e' },
    info: { main: '#22d3ee' },
    background: {
      default: '#0b1220',  // --bg
      paper: '#111a2e',    // --bg-elev
    },
    text: {
      primary: '#e2e8f0',
      secondary: '#94a3b8',
      disabled: '#64748b',
    },
    divider: 'rgba(148, 163, 184, 0.12)',
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontSize: 14,
    h4: { fontWeight: 600, fontSize: 24 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600, fontSize: 18 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme }) => ({
          background: alpha('#0f172a', 0.7),
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 8,
        }),
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500, borderRadius: 6 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: 11, height: 24, borderRadius: 14 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({
          fontSize: 11,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: theme.palette.text.secondary,
        }),
      },
    },
  },
});
