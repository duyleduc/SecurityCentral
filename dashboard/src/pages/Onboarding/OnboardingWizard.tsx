import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api/client.js';

interface OnboardingStatus {
  completed: boolean;
  steps: { code: boolean; infrastructure: boolean; ssl: boolean };
}

const STEPS = [
  {
    key: 'code' as const,
    icon: '📦',
    title: 'Connect Source Code',
    desc: 'Connect GitHub, GitLab, or Bitbucket to scan your repositories for vulnerabilities and secrets.',
    action: 'Connect Provider',
    link: '/integrations',
  },
  {
    key: 'infrastructure' as const,
    icon: '🖥️',
    title: 'Monitor Servers',
    desc: 'Install the agent on your servers or connect a cloud account (AWS, Azure, GCP, Proxmox) to discover infrastructure.',
    action: 'Set Up',
    link: '/infrastructure/coverage',
    secondaryAction: 'Copy Install Command',
  },
  {
    key: 'ssl' as const,
    icon: '🔒',
    title: 'Monitor Domains',
    desc: 'Add domains to monitor TLS certificates for expiration, weak keys, and chain issues.',
    action: 'Add Domains',
    link: '/monitoring/domains',
  },
];

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [copiedCmd, setCopiedCmd] = useState(false);

  const { data: envelope } = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => apiGet<OnboardingStatus>('/organizations/me/onboarding-status'),
  });
  const status = envelope?.data as OnboardingStatus | undefined;

  const completeMutation = useMutation({
    mutationFn: () => apiPost('/organizations/me/onboarding-complete', {}),
    onSuccess: () => navigate('/dashboard'),
  });

  const handleSkip = () => {
    completeMutation.mutate();
  };

  const handleCopyInstall = () => {
    navigator.clipboard.writeText('curl -fsSL https://install.securitycentral.io | bash -s -- --api-key YOUR_API_KEY --environment production');
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const allDone = status?.steps.code && status?.steps.infrastructure && status?.steps.ssl;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 800, width: '100%' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Welcome to SecurityCentral</h1>
          <p style={{ fontSize: 15, color: '#666' }}>Let's set up your security monitoring in a few steps.</p>
        </div>

        {/* Step Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 32 }}>
          {STEPS.map((step) => {
            const done = status?.steps[step.key] ?? false;
            return (
              <div key={step.key} style={{
                background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: done ? '2px solid #16a34a' : '2px solid transparent',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>{step.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{step.title}</h3>
                <p style={{ fontSize: 13, color: '#666', lineHeight: 1.5, flex: 1, marginBottom: 16 }}>{step.desc}</p>

                {done ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#16a34a', fontSize: 13, fontWeight: 500 }}>
                    <span>✓</span> Complete
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button onClick={() => navigate(step.link)}
                      style={{ padding: '10px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                      {step.action}
                    </button>
                    {step.key === 'infrastructure' && (
                      <button onClick={handleCopyInstall}
                        style={{ padding: '8px 16px', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 6, fontSize: 12, cursor: 'pointer', width: '100%' }}>
                        {copiedCmd ? '✓ Copied!' : 'Copy Install Command'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center' }}>
          {allDone ? (
            <button onClick={() => completeMutation.mutate()}
              style={{ padding: '12px 32px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Go to Dashboard →
            </button>
          ) : (
            <button onClick={handleSkip} disabled={completeMutation.isPending}
              style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer', padding: 8 }}>
              {completeMutation.isPending ? 'Redirecting...' : 'Skip for now — go to dashboard'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
