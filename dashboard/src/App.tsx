import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
import { InfrastructureCoveragePage } from './pages/Infrastructure/CoverageDashboard.js';
import { DomainMonitoringPage } from './pages/Monitoring/DomainMonitoring.js';
import { OnboardingWizard } from './pages/Onboarding/OnboardingWizard.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}

/** Dashboard with onboarding redirect — checks if org has completed onboarding */
function DashboardWithOnboardingCheck() {
  return <DashboardOverview />;
}

// Note: The actual onboarding redirect is handled by the OnboardingWizard itself.
// When a new org first visits /dashboard and has no data, the dashboard shows an
// empty state. The sidebar "Get Started" link or the empty dashboard CTA points
// to /onboarding. After completing onboarding, the org.onboardingCompleted flag
// is set and the wizard won't show again.

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Onboarding wizard */}
            <Route path="/onboarding" element={<ProtectedRoute><OnboardingWizard /></ProtectedRoute>} />

            {/* Protected routes */}
            <Route path="/dashboard" element={<ProtectedLayout><DashboardWithOnboardingCheck /></ProtectedLayout>} />
            <Route path="/findings" element={<ProtectedLayout><FindingsPage /></ProtectedLayout>} />
            <Route path="/findings/:id" element={<ProtectedLayout><FindingsPage /></ProtectedLayout>} />
            <Route path="/assets/repositories" element={<ProtectedLayout><AssetsPage tab="repositories" /></ProtectedLayout>} />
            <Route path="/assets/servers" element={<ProtectedLayout><AssetsPage tab="servers" /></ProtectedLayout>} />
            <Route path="/assets/certificates" element={<ProtectedLayout><AssetsPage tab="certificates" /></ProtectedLayout>} />
            <Route path="/scans" element={<ProtectedLayout><ScansPage /></ProtectedLayout>} />
            <Route path="/infrastructure/coverage" element={<ProtectedLayout><InfrastructureCoveragePage /></ProtectedLayout>} />
            <Route path="/monitoring/domains" element={<ProtectedLayout><DomainMonitoringPage /></ProtectedLayout>} />
            <Route path="/integrations" element={<ProtectedLayout><IntegrationsPage /></ProtectedLayout>} />
            <Route path="/integrations/:provider/repos" element={<ProtectedLayout><RepoSelectionPage /></ProtectedLayout>} />
            <Route path="/settings" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
