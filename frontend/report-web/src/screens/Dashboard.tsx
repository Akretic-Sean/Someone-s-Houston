import { useState } from 'react';
import { Brand, Card, StatusPill, initials } from '../components/Bits';
import { CONNECTORS, type ConnectorId, type ConnectorStates } from '../data/connectors';
import { KPIS, REPORT_SUMMARIES } from '../data/report';

const NAV = ['Reports', 'People', 'Connectors', 'Insights', 'Settings'] as const;

export default function Dashboard({
  nav,
  onNav,
  connectors,
  onToggleConnector,
  onOpenReport,
  onCreate,
}: {
  nav: string;
  onNav: (nav: string) => void;
  connectors: ConnectorStates;
  onToggleConnector: (id: ConnectorId) => void;
  onOpenReport: () => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState('');

  const rows = REPORT_SUMMARIES.filter((r) =>
    `${r.name} ${r.origin} ${r.role}`.toLowerCase().includes(query.toLowerCase()),
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
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>Priya Natarajan</div>
          Aurelia Robotics
        </div>
      </aside>

      <main className="dash-main">
        {nav === 'Reports' ? (
          <>
            <div className="dash-head">
              <div>
                <span className="eyebrow">Reports</span>
                <h1 className="greeting">
                  Good morning, <em>Priya</em>
                </h1>
              </div>
              <button type="button" className="btn btn-primary" onClick={onCreate}>
                + Create relocation report
              </button>
            </div>

            <div className="kpis">
              {KPIS.map((k) => (
                <Card key={k.label}>
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-value">
                    {k.value}
                    <span className="kpi-delta">{k.delta}</span>
                  </div>
                  <div className="kpi-sub">{k.sub}</div>
                </Card>
              ))}
            </div>

            <Card>
              <div className="sec-head">
                <h2 style={{ fontSize: 16 }}>Recent reports</h2>
                <input
                  aria-label="Search reports"
                  placeholder="Search by name, city or role"
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
                      <th>Name</th>
                      <th>Moving from</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} onClick={onOpenReport}>
                        <td>
                          <span className="who">
                            <span className="avatar" aria-hidden="true">
                              {initials(r.name)}
                            </span>
                            {r.name}
                          </span>
                        </td>
                        <td>{r.origin}</td>
                        <td>{r.role}</td>
                        <td>
                          <StatusPill status={r.status} />
                        </td>
                        <td style={{ color: 'var(--text-3)' }}>{r.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 ? <div className="empty">Nothing matches &ldquo;{query}&rdquo;.</div> : null}
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
              Connect a source once here, and it becomes available when you build a report.
              Only connected sources are offered in the builder.
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
