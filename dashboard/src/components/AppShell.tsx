import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/findings', label: 'Findings', icon: '🔍' },
  { path: '/assets/repositories', label: 'Repositories', icon: '📦' },
  { path: '/assets/servers', label: 'Servers', icon: '🖥️' },
  { path: '/assets/certificates', label: 'Certificates', icon: '🔒' },
  { path: '/infrastructure/coverage', label: 'Coverage', icon: '☁️' },
  { path: '/monitoring/domains', label: 'Monitoring', icon: '📡' },
  { path: '/scans', label: 'Scans', icon: '⚡' },
  { path: '/integrations', label: 'Integrations', icon: '🔗' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

const sidebarStyle: React.CSSProperties = {
  width: 240,
  background: '#1a1a2e',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  position: 'fixed',
  left: 0,
  top: 0,
};

const linkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 20px',
  color: '#a0a0b8',
  textDecoration: 'none',
  fontSize: 14,
  borderLeft: '3px solid transparent',
  transition: 'all 0.15s',
};

const activeLinkStyle: React.CSSProperties = {
  ...linkStyle,
  color: '#fff',
  background: 'rgba(255,255,255,0.08)',
  borderLeftColor: '#2563eb',
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex' }}>
      {/* Sidebar */}
      <nav style={sidebarStyle}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>SecurityCentral</h1>
        </div>

        <div style={{ flex: 1, paddingTop: 8 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => (isActive ? activeLinkStyle : linkStyle)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 12, color: '#a0a0b8', marginBottom: 8 }}>
            {user?.email ?? 'User'}
          </div>
          <button
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', color: '#a0a0b8', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ marginLeft: 240, flex: 1, padding: 24, background: '#f8f9fa', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  );
}
