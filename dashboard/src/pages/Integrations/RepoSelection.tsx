import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProviderRepos, useSyncRepos, useUnsyncRepo, type DiscoveredRepo } from '../../api/hooks.js';

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', Go: '#00add8', Python: '#3776ab',
  Java: '#b07219', Rust: '#dea584', Ruby: '#701516', PHP: '#4f5d95', Kotlin: '#A97BFF',
};

export function RepoSelectionPage() {
  const { provider } = useParams<{ provider: string }>();
  const providerName = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : provider ?? '';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncResult, setSyncResult] = useState<{ synced: number; errors: string[] } | null>(null);

  const perPage = 50;
  const repos = useProviderRepos(provider ?? '', { search: search || undefined, page, per_page: perPage });
  const syncMutation = useSyncRepos(provider ?? '');
  const unsyncMutation = useUnsyncRepo(provider ?? '');

  const data = (repos.data?.data ?? []) as DiscoveredRepo[];
  const total = repos.data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / perPage);

  // Only show unsynced repos in selection
  const unsyncedOnPage = useMemo(() => data.filter((r) => !r.synced), [data]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelected(new Set(unsyncedOnPage.map((r) => r.provider_id)));
  };

  const selectNone = () => setSelected(new Set());

  const handleSync = async () => {
    if (selected.size === 0) return;
    setSyncResult(null);
    try {
      const result = await syncMutation.mutateAsync([...selected]);
      setSyncResult(result.data as { synced: number; errors: string[] });
      setSelected(new Set());
    } catch (err) {
      setSyncResult({ synced: 0, errors: [(err as Error).message] });
    }
  };

  const handleUnsync = (providerId: string) => {
    if (confirm('Unsync this repository? Historical data will be preserved.')) {
      unsyncMutation.mutate(providerId);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <Link to="/integrations" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to Integrations</Link>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 8, marginBottom: 0 }}>Select {providerName} Repositories</h2>
          <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Choose which repositories to scan for vulnerabilities</p>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div style={{
          background: syncResult.errors.length > 0 ? '#fffbeb' : '#f0fdf4',
          border: `1px solid ${syncResult.errors.length > 0 ? '#fde68a' : '#bbf7d0'}`,
          borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 13,
        }}>
          {syncResult.synced > 0 && <span style={{ color: '#16a34a', fontWeight: 500 }}>{syncResult.synced} repo(s) synced successfully. </span>}
          {syncResult.errors.map((e, i) => <div key={i} style={{ color: '#ca8a04', marginTop: 4 }}>{e}</div>)}
        </div>
      )}

      {/* Search + bulk actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }}
          style={{ flex: 1, maxWidth: 320, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
        <button onClick={selectAll} style={linkBtn}>Select All</button>
        <button onClick={selectNone} style={linkBtn}>None</button>
        <span style={{ fontSize: 12, color: '#666' }}>
          {selected.size > 0 ? `${selected.size} selected` : `${total} repos found`}
        </span>
      </div>

      {/* Repo list */}
      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        {repos.isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading repositories from {providerName}...</div>
        ) : data.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
            {search ? 'No repositories match your search' : 'No repositories found'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
                <th style={{ ...th, width: 40 }}></th>
                <th style={th}>Repository</th>
                <th style={th}>Language</th>
                <th style={th}>Visibility</th>
                <th style={th}>Last Updated</th>
                <th style={th}>Status</th>
                <th style={{ ...th, width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.map((repo) => {
                const isSelected = selected.has(repo.provider_id);
                const langColor = repo.language ? LANG_COLOR[repo.language] ?? '#6b7280' : undefined;

                return (
                  <tr key={repo.provider_id} style={{ borderBottom: '1px solid #f3f4f6', background: isSelected ? '#eff6ff' : undefined }}>
                    <td style={td}>
                      {repo.synced ? (
                        <span style={{ color: '#16a34a', fontSize: 16 }}>✓</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(repo.provider_id)}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>
                      {repo.full_name}
                    </td>
                    <td style={td}>
                      {repo.language ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: langColor, display: 'inline-block' }} />
                          {repo.language}
                        </span>
                      ) : (
                        <span style={{ color: '#999', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: repo.visibility === 'public' ? '#f0fdf4' : '#f3f4f6', color: repo.visibility === 'public' ? '#16a34a' : '#666' }}>
                        {repo.visibility || 'private'}
                      </span>
                    </td>
                    <td style={{ ...td, color: '#666', fontSize: 12 }}>
                      {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={td}>
                      {repo.synced ? (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f0fdf4', color: '#16a34a', fontWeight: 500 }}>Synced</span>
                      ) : (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: '#999' }}>Not synced</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {repo.synced && (
                        <button onClick={() => handleUnsync(repo.provider_id)} disabled={unsyncMutation.isPending}
                          style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                          Unsync
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer: pagination + sync button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={page <= 1} onClick={() => { setPage(page - 1); setSelected(new Set()); }}
            style={paginationBtn(page <= 1)}>Previous</button>
          <span style={{ fontSize: 13, color: '#666', lineHeight: '32px' }}>Page {page} of {totalPages || 1}</span>
          <button disabled={page >= totalPages} onClick={() => { setPage(page + 1); setSelected(new Set()); }}
            style={paginationBtn(page >= totalPages)}>Next</button>
        </div>

        <button
          onClick={handleSync}
          disabled={selected.size === 0 || syncMutation.isPending}
          style={{
            padding: '10px 24px', background: selected.size > 0 ? '#2563eb' : '#d1d5db',
            color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600,
            cursor: selected.size > 0 ? 'pointer' : 'default',
            opacity: syncMutation.isPending ? 0.7 : 1,
          }}
        >
          {syncMutation.isPending ? 'Syncing...' : `Sync ${selected.size} Selected`}
        </button>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '10px 12px' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', padding: '4px 8px' };
const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff',
  fontSize: 13, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
});
