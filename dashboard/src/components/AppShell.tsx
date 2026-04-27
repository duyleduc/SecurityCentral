import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Divider,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import CodeIcon from '@mui/icons-material/Code';
import BugReportIcon from '@mui/icons-material/BugReport';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import ShieldIcon from '@mui/icons-material/Shield';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../auth/AuthContext';
import { useRealtimeEvents } from '../ws/useRealtimeEvents';
import { ProjectSwitcher } from './ProjectSwitcher';
import { useDashboardSummary } from '../api/hooks';
import { useProjectScope, useScopedNavigate } from '../lib/useProjectScope';

const DRAWER_WIDTH = 240;

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
  { label: 'Projects', path: '/projects', icon: <FolderIcon /> },
  { label: 'Domains', path: '/domains', icon: <DnsIcon /> },
  { label: 'Servers', path: '/servers', icon: <StorageIcon /> },
  { label: 'Repositories', path: '/repositories', icon: <CodeIcon /> },
  { label: 'Findings', path: '/findings', icon: <BugReportIcon /> },
  { label: 'Settings', path: '/settings', icon: <SettingsIcon /> },
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout, user } = useAuth();
  const scopedNavigate = useScopedNavigate();
  const location = useLocation();

  // Subscribe to all real-time WebSocket events
  useRealtimeEvents();

  // Pull summary so we can show count badges in the sidebar (matches mockup).
  const { projectId } = useProjectScope();
  const { data: summary } = useDashboardSummary(projectId);
  const findingsCount = summary?.findings?.total ?? 0;
  const itemCounts: Record<string, number> = {
    '/projects': summary?.assets?.projects ?? 0,
    '/domains': summary?.assets?.domains ?? 0,
    '/servers': summary?.assets?.servers ?? 0,
    '/repositories': summary?.assets?.repositories ?? 0,
    '/findings': findingsCount,
  };

  const drawer = (
    <Box>
      <Toolbar>
        <ShieldIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" noWrap fontWeight={700}>
          SecurityCentral
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {NAV_ITEMS.map((item) => {
          const count = itemCounts[item.path] ?? 0;
          const showCount = count > 0 && item.path !== '/' && item.path !== '/settings';
          const isActive = location.pathname === item.path
            || (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <ListItemButton
              key={item.path}
              selected={isActive}
              onClick={() => { scopedNavigate(item.path); setMobileOpen(false); }}
              sx={{
                mx: 1, borderRadius: 1.5, mb: 0.25,
                position: 'relative',
                '&.Mui-selected': {
                  bgcolor: 'rgba(99, 102, 241, 0.15)',
                  color: '#c7d2fe',
                  '& .MuiListItemIcon-root': { color: '#c7d2fe' },
                  '&::before': {
                    content: '""', position: 'absolute', left: -4, top: 6, bottom: 6, width: 3,
                    background: '#6366f1', borderRadius: '0 2px 2px 0',
                  },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label}
                primaryTypographyProps={{ fontSize: 14, fontWeight: isActive ? 500 : 400 }} />
              {showCount && (
                <Box sx={{
                  ml: 1, px: 1, py: 0.125, borderRadius: 5,
                  fontSize: 11, fontWeight: 600,
                  bgcolor: isActive ? 'rgba(99, 102, 241, 0.3)' : 'rgba(148, 163, 184, 0.15)',
                  color: isActive ? '#c7d2fe' : 'text.secondary',
                  minWidth: 22, textAlign: 'center',
                }}>
                  {count}
                </Box>
              )}
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ mt: 'auto', p: 2 }}>
        <Divider sx={{ mb: 1 }} />
        <ListItemButton onClick={logout} sx={{ borderRadius: 2 }}>
          <ListItemIcon sx={{ minWidth: 40 }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText primary="Logout" secondary={user?.email} />
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
          bgcolor: 'background.paper',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
        elevation={0}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ mr: 2, fontSize: 15, fontWeight: 500 }}>
            {NAV_ITEMS.find((n) => n.path === location.pathname || (n.path !== '/' && location.pathname.startsWith(n.path)))?.label ?? 'SecurityCentral'}
          </Typography>
          <ProjectSwitcher />
          {/* Search bar (mockup .search) */}
          <Box sx={{
            ml: 2, display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1,
            background: 'rgba(148, 163, 184, 0.08)', borderRadius: 1.5, px: 1.5, py: 0.625,
            width: 300, maxWidth: '40%', border: '1px solid transparent',
            '&:focus-within': { borderColor: 'rgba(99, 102, 241, 0.4)', background: 'rgba(148, 163, 184, 0.12)' },
          }}>
            <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Box component="input"
              placeholder="Search servers, domains, repos…"
              sx={{
                background: 'none', border: 'none', outline: 'none',
                color: 'text.primary', flex: 1, fontFamily: 'inherit', fontSize: 13,
                '&::placeholder': { color: 'text.disabled' },
              }} />
            <Box sx={{
              fontSize: 10, color: 'text.disabled',
              border: '1px solid', borderColor: 'divider', borderRadius: 0.5,
              px: 0.625, py: 0.125, fontFamily: 'monospace',
            }}>
              ⌘K
            </Box>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
        }}
      >
        {drawer}
      </Drawer>

      {/* Desktop drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
        open
      >
        {drawer}
      </Drawer>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: '64px',
          minHeight: 'calc(100vh - 64px)',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
