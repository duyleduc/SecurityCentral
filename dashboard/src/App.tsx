import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { theme } from './theme/theme.js';
import { AuthProvider } from './auth/AuthContext.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { AppShell } from './components/AppShell.js';

import { LoginPage } from './pages/Login/index.js';
import { RegisterPage } from './pages/Register/index.js';
import { DashboardOverview } from './pages/DashboardOverview/index.js';
import { FindingsPage } from './pages/Findings/index.js';
import { AssetsPage } from './pages/Assets/index.js';
import { ScansPage } from './pages/Scans/index.js';
import { IntegrationsPage } from './pages/Integrations/index.js';
import { RepoSelectionPage } from './pages/Integrations/RepoSelection.js';
import { SettingsPage } from './pages/Settings/index.js';
import { DomainMonitoringPage } from './pages/Monitoring/DomainMonitoring.js';
import { OnboardingWizard } from './pages/Onboarding/OnboardingWizard.js';
import { ProjectsPage } from './pages/Projects/index.js';
import { ScanDetailPage } from './pages/Scans/ScanDetail.js';
import { EndpointDetailPage } from './pages/Monitoring/EndpointDetail.js';
import { CertificateDetailPage } from './pages/Assets/CertificateDetail.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />

              {/* Protected */}
              <Route path="/dashboard" element={<ProtectedLayout><DashboardOverview /></ProtectedLayout>} />
              <Route path="/projects" element={<ProtectedLayout><ProjectsPage /></ProtectedLayout>} />
              <Route path="/projects/:id" element={<ProtectedLayout><ProjectsPage /></ProtectedLayout>} />
              <Route path="/findings" element={<ProtectedLayout><FindingsPage /></ProtectedLayout>} />
              <Route path="/findings/:id" element={<ProtectedLayout><FindingsPage /></ProtectedLayout>} />
              <Route path="/assets/repositories" element={<ProtectedLayout><AssetsPage tab="repositories" /></ProtectedLayout>} />
              <Route path="/assets/servers" element={<ProtectedLayout><AssetsPage tab="servers" /></ProtectedLayout>} />
              <Route path="/assets/certificates" element={<ProtectedLayout><AssetsPage tab="certificates" /></ProtectedLayout>} />
              <Route path="/assets/certificates/:id" element={<ProtectedLayout><CertificateDetailPage /></ProtectedLayout>} />
              <Route path="/monitoring/domains" element={<ProtectedLayout><DomainMonitoringPage /></ProtectedLayout>} />
              <Route path="/monitoring/domains/:id" element={<ProtectedLayout><EndpointDetailPage /></ProtectedLayout>} />
              <Route path="/scans" element={<ProtectedLayout><ScansPage /></ProtectedLayout>} />
              <Route path="/scans/:id" element={<ProtectedLayout><ScanDetailPage /></ProtectedLayout>} />
              <Route path="/integrations" element={<ProtectedLayout><IntegrationsPage /></ProtectedLayout>} />
              <Route path="/integrations/:provider/repos" element={<ProtectedLayout><RepoSelectionPage /></ProtectedLayout>} />
              <Route path="/settings" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />

              {/* Default */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
