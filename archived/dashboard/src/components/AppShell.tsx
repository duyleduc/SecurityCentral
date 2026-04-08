import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { DRAWER_WIDTH } from '../theme/theme.js';

import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';

// MUI Icons
import DashboardIcon from '@mui/icons-material/Dashboard';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderIcon from '@mui/icons-material/Folder';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import SecurityIcon from '@mui/icons-material/Security';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CreditCardIcon from '@mui/icons-material/CreditCard';

type HeaderTitleContextValue = {
  title: string | null;
  setTitle: (value: string | null) => void;
};

const HeaderTitleContext = createContext<HeaderTitleContextValue | undefined>(undefined);

export function useHeaderTitle() {
  const ctx = useContext(HeaderTitleContext);
  if (!ctx) throw new Error('useHeaderTitle must be used within AppShell');
  return ctx;
}

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Home', icon: <DashboardIcon /> },
  { path: '/projects', label: 'Projects', icon: <FolderIcon /> },
  { path: '/findings', label: 'Findings', icon: <BugReportIcon /> },
  { path: '/reports', label: 'Reports', icon: <AssessmentIcon /> },
  { path: '/integrations', label: 'Integrations', icon: <ExtensionIcon /> },
  { path: '/billing', label: 'Billing', icon: <CreditCardIcon /> },
  { path: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [customTitle, setCustomTitle] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const pageTitle = (() => {
    if (location.pathname.startsWith('/assets')) return 'Assets';
    if (location.pathname.startsWith('/findings')) return 'Findings';
    if (location.pathname.startsWith('/reports')) return 'Reports';
    if (location.pathname.startsWith('/integrations')) return 'Integrations';
    if (location.pathname.startsWith('/billing')) return 'Billing';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    if (location.pathname.startsWith('/projects')) return 'Projects';
    return 'Today’s Risks';
  })();

  const headerTitle = customTitle ?? pageTitle;
  const ctxValue = useMemo(() => ({ title: customTitle, setTitle: setCustomTitle }), [customTitle]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f6f4ef' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            bgcolor: '#fbfaf6',
            color: '#0b1320',
            borderRight: '1px solid rgba(11, 19, 32, 0.08)',
          },
        }}
      >
        {/* Logo */}
        <Toolbar sx={{ px: 2.5, py: 2 }}>
          <SecurityIcon sx={{ mr: 1.5, color: '#0f766e', fontSize: 28 }} />
          <Typography variant="h6" noWrap sx={{ color: '#0b1320', fontWeight: 700, letterSpacing: '-0.02em' }}>
            SecurityCentral
          </Typography>
        </Toolbar>

        <Divider sx={{ borderColor: 'rgba(11, 19, 32, 0.08)' }} />

        {/* Navigation */}
        <List sx={{ flex: 1, px: 1.5, py: 1 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
            return (
              <ListItemButton
                key={item.path}
                component={NavLink}
                to={item.path}
                sx={{
                  borderRadius: 2,
                  mb: 0.3,
                  px: 2,
                  py: 0.8,
                  color: isActive ? '#0b1320' : '#556178',
                  bgcolor: isActive ? 'rgba(15, 118, 110, 0.12)' : 'transparent',
                  borderLeft: isActive ? '3px solid #0f766e' : '3px solid transparent',
                  '&:hover': {
                    bgcolor: isActive ? 'rgba(15, 118, 110, 0.18)' : 'rgba(11, 19, 32, 0.04)',
                    color: '#0b1320',
                  },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: isActive ? 600 : 400 }}
                />
              </ListItemButton>
            );
          })}
        </List>

        <Divider sx={{ borderColor: 'rgba(11, 19, 32, 0.08)' }} />

        {/* User section */}
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: '#e2e8f0', color: '#0b1320', fontSize: 14 }}>
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <Typography variant="body2" noWrap sx={{ color: '#0b1320', fontSize: '0.8rem' }}>
              {user?.email ?? 'User'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b' }}>
              {user?.role ?? 'member'}
            </Typography>
          </Box>
          <Tooltip title="Sign out">
            <IconButton size="small" onClick={handleLogout} sx={{ color: '#64748b', '&:hover': { color: '#ef4444' } }}>
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Drawer>

      {/* Main content */}
      <HeaderTitleContext.Provider value={ctxValue}>
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            bgcolor: 'background.default',
            p: 3,
            minHeight: '100vh',
            backgroundImage: 'radial-gradient(circle at 10% 0%, rgba(15, 118, 110, 0.08), transparent 35%), radial-gradient(circle at 90% 0%, rgba(249, 115, 22, 0.08), transparent 40%)',
          }}
        >
          {children}
        </Box>
      </HeaderTitleContext.Provider>
    </Box>
  );
}
