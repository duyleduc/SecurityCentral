export function AssetsPage({ tab }: { tab: 'repositories' | 'servers' | 'certificates' }) {
  const titles = { repositories: 'Repositories', servers: 'Servers', certificates: 'Certificates' };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>{titles[tab]}</h2>
      <p style={{ color: '#666' }}>{titles[tab]} management — coming soon.</p>
    </div>
  );
}
