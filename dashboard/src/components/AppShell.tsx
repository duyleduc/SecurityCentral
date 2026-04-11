import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
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
import { useAuth } from '../auth/AuthContext';
import { useRealtimeEvents } from '../ws/useRealtimeEvents';

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
  const navigate = useNavigate();
  const location = useLocation();

  // Subscribe to all real-time WebSocket events
  useRealtimeEvents();

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
        {NAV_ITEMS.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              setMobileOpen(false);
            }}
            sx={{
              mx: 1,
              borderRadius: 2,
              mb: 0.5,
              '&.Mui-selected': {
                bgcolor: 'primary.main',
                color: 'white',
                '& .MuiListItemIcon-root': { color: 'white' },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
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
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            {NAV_ITEMS.find((n) => n.path === location.pathname)?.label ?? 'SecurityCentral'}
          </Typography>
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
