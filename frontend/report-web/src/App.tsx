import { useCallback, useEffect, useState } from 'react';
import Dashboard from './screens/Dashboard';
import CreateReport from './screens/CreateReport';
import CandidateReport from './screens/CandidateReport';
import { DEFAULT_WEIGHTS } from './data/offices';
import { PROFILE_DEFAULTS } from './data/profile';
import type { CandidateProfile, OfficeId, ReportMode, Tenure, Weights } from './types';

export type View = 'dashboard' | 'create' | 'report';

/**
 * What the recruiter configures on screen 2 and the report is rendered with on
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
  ['dashboard', '1 · Recruiter dashboard'],
  ['create', '2 · Create report'],
  ['report', '3 · Candidate report'],
];

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [config, setConfig] = useState<ReportConfig>(INITIAL_CONFIG);
  const [toast, setToast] = useState('');

  const go = useCallback((next: View) => {
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  const showToast = useCallback((message: string) => setToast(message), []);

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
        <span className="proto-note">Frontend only · mocked data</span>
      </div>

      {view === 'dashboard' && <Dashboard onOpenReport={() => go('report')} onCreate={() => go('create')} />}
      {view === 'create' && (
        <CreateReport
          config={config}
          onChange={setConfig}
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
