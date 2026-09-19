import { useMemo, useState } from 'react';
import { scoreNeighborhoods } from '../../../shared/scoring.mjs';
import Dashboard from './screens/Dashboard';
import CreateReport from './screens/CreateReport';
import CandidateReport from './screens/CandidateReport';
import { DEFAULT_CONNECTORS, type ConnectorId, type ConnectorStates } from './data/connectors';
import { DEFAULT_WEIGHTS } from './data/offices';
import { useScoringData } from './hooks/useScoringData';
import type { CandidateProfile, OfficeId, ReportMode, Tenure, Weights } from './types';

export type View = 'dashboard' | 'create' | 'report';
export interface ReportConfig {
  profile: CandidateProfile;
  office: OfficeId;
  airport: 'nearest' | 'iah' | 'hou';
  mode: ReportMode;
  tenure: Tenure;
  weights: Weights;
}

const INITIAL_CONFIG: ReportConfig = {
  profile: { role: '', city: '', salary: '', offer: '', office: '', grocery: '', food: '', hobbies: '', sports: '', workout: '', airport: '', health: '' },
  office: 'ion', airport: 'nearest', mode: 'offer', tenure: 'rent', weights: DEFAULT_WEIGHTS,
};

export default function App() {
  const [view, setView] = useState<View>('create');
  const [config, setConfig] = useState<ReportConfig>(INITIAL_CONFIG);
  const [connectors, setConnectors] = useState<ConnectorStates>(DEFAULT_CONNECTORS);
  const [dashboardNav, setDashboardNav] = useState('Reports');
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const data = useScoringData();

  const scoring = useMemo(() => {
    if (!data.payload) return { result: null, error: null };
    try { return { result: scoreNeighborhoods(data.payload, config), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : 'Choose valid priorities.' }; }
  }, [data.payload, data.loadedAt, config]);

  function go(next: View) {
    setView(next);
    window.scrollTo(0, 0);
  }

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const payload = await data.refresh();
      const result = scoreNeighborhoods(payload, config);
      if (!result.ranked.length) throw new Error('No neighborhoods have all of the evidence needed for these priorities. Review the missing-data details or retry after the data is refreshed.');
      setGenerated(true);
      go('report');
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Could not generate the report. Please retry.');
    } finally { setGenerating(false); }
  }

  function changeConfig(next: ReportConfig) {
    setConfig(next);
    setGenerateError(null);
  }

  return (
    <div className="app">
      <div className="proto">
        <span className="proto-label">Someone’s Houston</span>
        <button className="pill" aria-pressed={view === 'create'} onClick={() => go('create')}>Configure priorities</button>
        <button className="pill" aria-pressed={view === 'report'} disabled={!generated} onClick={() => go('report')}>Neighborhood report</button>
        <button className="pill" aria-pressed={view === 'dashboard'} onClick={() => go('dashboard')}>Sample dashboard</button>
      </div>
      {view === 'dashboard' && <>
        <p className="prototype-notice">Dashboard and connector demonstrations use sample records. Reports generated through Configure priorities use live Supabase evidence and are not saved.</p>
        <Dashboard nav={dashboardNav} onNav={setDashboardNav} connectors={connectors}
          onToggleConnector={(id: ConnectorId) => setConnectors(c => ({ ...c, [id]: c[id] === 'connected' ? 'idle' : 'connected' }))}
          onOpenReport={() => go('create')} onCreate={() => go('create')} />
      </>}
      {view === 'create' && <CreateReport config={config} onChange={changeConfig}
        result={scoring.result} loading={data.loading} generating={generating}
        error={generateError ?? data.error ?? scoring.error}
        onRetry={() => { setGenerateError(null); void data.refresh(true).catch(() => {}); }} onGenerate={generate} />}
      {view === 'report' && <CandidateReport config={config} result={scoring.result}
        loading={data.loading} error={data.error ?? scoring.error} payload={data.payload}
        onRetry={() => { void data.refresh(true).catch(() => {}); }} onConfigure={() => go('create')} />}
    </div>
  );
}
