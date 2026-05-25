import { useState, useEffect } from 'react';

/**
 * RepoPicker — fetches repos from GitHub's public API using the
 * company's github handle (org or user), then lets them select.
 *
 * Falls back to a manual text input if:
 *   - No github handle is set on the profile
 *   - API returns an error (private org, rate-limited)
 *   - User clicks "Enter manually"
 */
export default function RepoPicker({ githubHandle, value, onChange }) {
  const [repos,   setRepos]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [manual,  setManual]  = useState(!githubHandle);
  const [query,   setQuery]   = useState('');

  useEffect(() => {
    if (!githubHandle || manual) return;
    setLoading(true);
    setError(null);

    // Try org first, fall back to user
    async function fetchRepos() {
      try {
        // Try as org
        let res = await fetch(
          `https://api.github.com/orgs/${githubHandle}/repos?per_page=100&sort=updated`,
          { headers: { Accept: 'application/vnd.github+json' } },
        );
        if (!res.ok) {
          // Fall back to user
          res = await fetch(
            `https://api.github.com/users/${githubHandle}/repos?per_page=100&sort=updated`,
            { headers: { Accept: 'application/vnd.github+json' } },
          );
        }
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = await res.json();
        setRepos(data.map(r => ({
          full_name:   r.full_name,
          description: r.description,
          language:    r.language,
          private:     r.private,
          updated_at:  r.updated_at,
        })));
      } catch (err) {
        setError(err.message);
        setManual(true);
      } finally {
        setLoading(false);
      }
    }

    fetchRepos();
  }, [githubHandle, manual]);

  const filtered = repos.filter(r =>
    !query || r.full_name.toLowerCase().includes(query.toLowerCase()),
  );

  if (!githubHandle || manual) {
    return (
      <div className="flex flex-col gap-1.5">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="owner/repo"
          className="input"
        />
        {githubHandle && (
          <button type="button" onClick={() => setManual(false)}
            className="text-xs text-muted hover:text-accent font-mono self-start transition-colors">
            ← Browse {githubHandle}'s repos
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Selected repo */}
      {value && (
        <div className="flex items-center justify-between bg-dark border border-accent/30 rounded-xl px-4 py-2.5">
          <span className="text-sm font-mono text-white">{value}</span>
          <button type="button" onClick={() => onChange('')}
            className="text-muted hover:text-white text-lg w-5 h-5 flex items-center justify-center">×</button>
        </div>
      )}

      {!value && (
        <>
          {/* Search */}
          <div className="relative">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={loading ? 'Loading repos…' : `Search ${githubHandle}'s repos…`}
              className="input"
              disabled={loading}
            />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Repo list */}
          {filtered.length > 0 && (
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
              {filtered.map(repo => (
                <button
                  key={repo.full_name}
                  type="button"
                  onClick={() => { onChange(repo.full_name); setQuery(''); }}
                  className="flex items-start justify-between px-4 py-2.5 hover:bg-surface text-left transition-colors gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-white truncate">{repo.full_name}</div>
                    {repo.description && (
                      <div className="text-xs text-muted truncate mt-0.5">{repo.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    {repo.language && (
                      <span className="text-xs text-muted font-mono">{repo.language}</span>
                    )}
                    {repo.private && (
                      <span className="text-xs text-yellow-400/70 font-mono">private</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {repos.length === 0 && !loading && (
            <p className="text-xs text-muted px-1">No repos found.</p>
          )}
        </>
      )}

      <button type="button" onClick={() => { setManual(true); }}
        className="text-xs text-muted hover:text-accent font-mono self-start transition-colors">
        + Enter manually instead
      </button>
    </div>
  );
}
