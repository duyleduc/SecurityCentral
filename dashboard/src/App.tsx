import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { theme } from './theme/theme';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/Login/LoginPage';
import { RegisterPage } from './pages/Register/RegisterPage';
import { DashboardOverviewPage } from './pages/DashboardOverview/DashboardOverviewPage';
import { ProjectsPage } from './pages/Projects/ProjectsPage';
import { ProjectDetailPage } from './pages/Projects/ProjectDetailPage';
import { DomainsPage } from './pages/Monitoring/DomainsPage';
import { DomainDetailPage } from './pages/Monitoring/DomainDetailPage';
import { ServersPage } from './pages/Servers/ServersPage';
import { ServerMonitoringPage } from './pages/Servers/ServerMonitoringPage';
import { ServerSecurityPage } from './pages/Servers/ServerSecurityPage';
import { ServerReportPage } from './pages/Servers/ServerReportPage';
import { FindingsPage } from './pages/Findings/FindingsPage';
import { FindingDetailPage } from './pages/Findings/FindingDetailPage';
import { RepositoriesPage } from './pages/Repositories/RepositoriesPage';
import { RepositoryDetailPage } from './pages/Repositories/RepositoryDetailPage';
import { SettingsPage } from './pages/Settings/SettingsPage';
import { RepoSelectionPage } from './pages/Settings/RepoSelectionPage';
import { OnboardingPage } from './pages/Onboarding/OnboardingPage';
import { AcceptInvitePage } from './pages/AcceptInvite/AcceptInvitePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/invite/:token" element={<AcceptInvitePage />} />

              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<DashboardOverviewPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/domains" element={<DomainsPage />} />
                <Route path="/domains/:id" element={<DomainDetailPage />} />
                <Route path="/servers" element={<ServersPage />} />
                <Route path="/servers/:id" element={<Navigate to="monitoring" replace />} />
                <Route path="/servers/:id/monitoring" element={<ServerMonitoringPage />} />
                <Route path="/servers/:id/security" element={<ServerSecurityPage />} />
                <Route path="/servers/:id/report" element={<ServerReportPage />} />
                <Route path="/repositories" element={<RepositoriesPage />} />
                <Route path="/repositories/:id" element={<RepositoryDetailPage />} />
                <Route path="/findings" element={<FindingsPage />} />
                <Route path="/findings/:id" element={<FindingDetailPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/integrations/:provider/repos" element={<RepoSelectionPage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
              </Route>

              {/* Catch-all: e.g. /index.html from GCS bucket root */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
