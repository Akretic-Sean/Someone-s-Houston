import { useCallback, useEffect, useState } from 'react';
import Dashboard from './screens/Dashboard';
import CreateReport from './screens/CreateReport';
import CandidateReport from './screens/CandidateReport';
import { DEFAULT_CONNECTORS, type ConnectorId, type ConnectorStates } from './data/connectors';
import { DEFAULT_WEIGHTS } from './data/offices';
import { PROFILE_DEFAULTS } from './data/profile';
import type { CandidateProfile, OfficeId, ReportMode, Tenure, Weights } from './types';

export type View = 'dashboard' | 'create' | 'report';

/**
 * What is configured on screen 2 and the report is rendered with on
 * screen 3. In production this is the `build_report` request body.
 */
export interface ReportConfig {
  profile: CandidateProfile;
  office: OfficeId;
  mode: ReportMode;
  tenure: Tenure;
  weights: Weights;
}

const INITIAL_CONFIG: ReportConfig = {
  profile: PROFILE_DEFAULTS,
  office: 'ion',
  mode: 'offer',
  tenure: 'rent',
  weights: DEFAULT_WEIGHTS,
};

const TABS: Array<[View, string]> = [
  ['dashboard', '1 · Dashboard'],
  ['create', '2 · Create report'],
  ['report', '3 · Report'],
];

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [config, setConfig] = useState<ReportConfig>(INITIAL_CONFIG);
  // Connectors are shared: the Connectors screen owns connecting them, and the
  // report builder only offers the ones already connected.
  const [connectors, setConnectors] = useState<ConnectorStates>(DEFAULT_CONNECTORS);
  const [dashboardNav, setDashboardNav] = useState('Reports');
  const [toast, setToast] = useState('');

  const go = useCallback((next: View) => {
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  const showToast = useCallback((message: string) => setToast(message), []);

  const toggleConnector = useCallback((id: ConnectorId) => {
    setConnectors((c) => ({ ...c, [id]: c[id] === 'connected' ? 'idle' : 'connected' }));
  }, []);

  /** From the builder's empty state: jump to the Connectors screen. */
  const openConnectors = useCallback(() => {
    setDashboardNav('Connectors');
    setView('dashboard');
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="app">
      <div className="proto">
        <span className="proto-label">Prototype</span>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="pill"
            aria-pressed={view === id}
            onClick={() => go(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'dashboard' && (
        <Dashboard
          nav={dashboardNav}
          onNav={setDashboardNav}
          connectors={connectors}
          onToggleConnector={toggleConnector}
          onOpenReport={() => go('report')}
          onCreate={() => go('create')}
        />
      )}
      {view === 'create' && (
        <CreateReport
          config={config}
          onChange={setConfig}
          connectors={connectors}
          onOpenConnectors={openConnectors}
          onGenerated={() => go('report')}
        />
      )}
      {view === 'report' && <CandidateReport config={config} onToast={showToast} />}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
