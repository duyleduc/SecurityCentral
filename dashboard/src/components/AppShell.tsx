import { type ReactNode } from 'react';
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

// MUI Icons
import DashboardIcon from '@mui/icons-material/Dashboard';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderIcon from '@mui/icons-material/Folder';
import DnsIcon from '@mui/icons-material/Dns';
import HttpsIcon from '@mui/icons-material/Https';
import RadarIcon from '@mui/icons-material/Radar';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import SecurityIcon from '@mui/icons-material/Security';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { path: '/projects', label: 'Projects', icon: <FolderIcon /> },
  { path: '/findings', label: 'Findings', icon: <BugReportIcon /> },
  { path: '/assets/servers', label: 'Servers', icon: <DnsIcon /> },
  { path: '/assets/certificates', label: 'Certificates', icon: <HttpsIcon /> },
  { path: '/monitoring/domains', label: 'Monitoring', icon: <RadarIcon /> },
  { path: '/integrations', label: 'Integrations', icon: <ExtensionIcon /> },
  { path: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            bgcolor: '#0f172a',
            color: '#e2e8f0',
            borderRight: 'none',
          },
        }}
      >
        {/* Logo */}
        <Toolbar sx={{ px: 2.5, py: 2 }}>
          <SecurityIcon sx={{ mr: 1.5, color: '#60a5fa', fontSize: 28 }} />
          <Typography variant="h6" noWrap sx={{ color: '#fff', fontWeight: 700, letterSpacing: '-0.02em' }}>
            SecurityCentral
          </Typography>
        </Toolbar>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

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
                  color: isActive ? '#fff' : '#94a3b8',
                  bgcolor: isActive ? 'rgba(37, 99, 235, 0.2)' : 'transparent',
                  borderLeft: isActive ? '3px solid #2563eb' : '3px solid transparent',
                  '&:hover': {
                    bgcolor: isActive ? 'rgba(37, 99, 235, 0.25)' : 'rgba(255,255,255,0.05)',
                    color: '#fff',
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

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

        {/* User section */}
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: '#334155', fontSize: 14 }}>
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <Typography variant="body2" noWrap sx={{ color: '#e2e8f0', fontSize: '0.8rem' }}>
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
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: 'background.default',
          p: 3,
          minHeight: '100vh',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
