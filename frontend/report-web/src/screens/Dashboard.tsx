import { useState } from 'react';
import { Brand, Card, initials } from '../components/Bits';
import { CONNECTORS, type ConnectorId, type ConnectorStates } from '../data/connectors';
import type { SavedReport } from '../data/savedReports';

const NAV = ['Reports', 'Candidates', 'Connectors', 'Insights', 'Settings'] as const;

export default function Dashboard({
  displayName, email, reports, count, loading, error, onRetry,
  nav,
  onNav,
  connectors,
  onToggleConnector,
  onOpenReport,
  onCreate,
}: {
  displayName: string; email: string; reports: SavedReport[]; count: number; loading: boolean; error: string; onRetry: () => void;
  nav: string;
  onNav: (nav: string) => void;
  connectors: ConnectorStates;
  onToggleConnector: (id: ConnectorId) => void;
  onOpenReport: (row: SavedReport) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState('');

  const rows = reports.filter((r) =>
    `${r.title} ${r.config.profile.city} ${r.config.profile.role}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="dash">
      <aside className="sidebar">
        <Brand sub="Relocation reports" />
        <nav aria-label="Sections" style={{ display: 'contents' }}>
          {NAV.map((n) => (
            <button
              key={n}
              type="button"
              className="nav-item"
              aria-current={nav === n}
              onClick={() => onNav(n)}
            >
              <span className="nav-dot" aria-hidden="true" />
              {n}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{displayName}</div>
          {email}
        </div>
      </aside>

      <main className="dash-main">
        {nav === 'Reports' ? (
          <>
            <div className="dash-head">
              <div>
                <span className="eyebrow">Reports</span>
                <h1 className="greeting">
                  Welcome, <em>{displayName}</em>
                </h1>
              </div>
              <button type="button" className="btn btn-primary" onClick={onCreate}>
                + Create relocation report
              </button>
            </div>

            <div className="kpis"><Card><div className="kpi-label">Saved reports</div><div className="kpi-value">{loading || error ? '—' : count}</div><div className="kpi-sub">Your private Supabase records</div></Card></div>
            {loading && <p role="status">Loading reports—</p>}
            {error && <p role="alert">{error} <button onClick={onRetry}>Retry</button></p>}
            <Card>
              <div className="sec-head">
                <h2 style={{ fontSize: 16 }}>Recent reports</h2>
                <input
                  aria-label="Search reports"
                  placeholder="Search reports"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{
                    background: 'rgba(0,0,0,.25)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 13,
                    minWidth: 200,
                  }}
                />
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Report</th>
                      <th>Origin</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} >
                        <td>
                          <span className="who">
                            <span className="avatar" aria-hidden="true">
                              {initials(r.title)}
                            </span>
                            <button type="button" disabled={loading} onClick={() => onOpenReport(r)}>{r.title}</button>
                          </span>
                        </td>
                        <td>{r.config.profile.city || '—'}</td>
                        <td>{r.config.profile.role || '—'}</td>
                        <td>
                          Saved
                        </td>
                        <td style={{ color: 'var(--text-3)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && !error && rows.length === 0 ? <div className="empty">{query ? `No reports match —${query}—.` : 'No saved reports yet. Create a relocation report to get started.'}</div> : null}
              </div>
            </Card>
          </>
        ) : nav === 'Connectors' ? (
          <>
            <span className="eyebrow">Connectors</span>
            <h1 className="greeting" style={{ marginBottom: 8 }}>
              Connectors
            </h1>
            <p className="section-lede">
              Demo controls only. These toggles do not connect external accounts. Neighborhood reports use the configured Supabase evidence pipeline.
            </p>

            <div className="connectors">
              {CONNECTORS.map((c) => {
                const connected = connectors[c.id] === 'connected';
                return (
                  <Card key={c.id}>
                    <div className="connector">
                      <span className="connector-mark" aria-hidden="true">
                        {c.mark}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="connector-name">{c.name}</span>
                        <br />
                        <span className="connector-state" data-connected={connected}>
                          {connected ? 'Connected' : 'Not connected'}
                        </span>
                      </span>
                    </div>
                    <p className="connector-blurb">{c.blurb}</p>
                    <button
                      type="button"
                      className={connected ? 'btn' : 'btn btn-primary'}
                      onClick={() => onToggleConnector(c.id)}
                    >
                      {connected ? 'Disconnect' : 'Connect'}
                    </button>
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <span className="eyebrow">{nav}</span>
            <h1 className="greeting" style={{ marginBottom: 20 }}>
              {nav}
            </h1>
            <Card>
              <div className="empty">
                {nav} is not part of this prototype. The flow to follow is Reports &rarr; Create
                relocation report.
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
