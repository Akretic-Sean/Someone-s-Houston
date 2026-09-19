import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { scoreNeighborhoods } from '../../../shared/scoring.mjs';
import Login from './screens/Login';
import { supabase } from './lib/supabase';
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
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authError, setAuthError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let receivedAuthEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      receivedAuthEvent = true;
      setSession(next);
      setAuthError('');
      setAuthReady(true);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || receivedAuthEvent) return;
      setSession(data.session);
      setAuthError(error?.message ?? '');
      setAuthReady(true);
    }).catch(() => {
      if (!alive || receivedAuthEvent) return;
      setAuthError('Your session could not be restored. Please sign in again.');
      setAuthReady(true);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    if (!supabase || signingOut) return;
    setSigningOut(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        // The SDK can clear this device even when remote session revocation fails.
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
        setAuthError(data.session ? 'Could not sign out. Please retry.'
          : 'Signed out on this device. Could not confirm sign-out on other devices.');
      } else { setSession(null); }
    } catch {
      setAuthError('Could not finish signing out. Reload to check your session.');
    } finally { setSigningOut(false); }
  }

  if (supabase && !authReady) return <div className="app login-loading" role="status">Loading…</div>;
  if (supabase && !session) return <div className="app">
    {authError && <p className="prototype-notice" role="alert">{authError}</p>}
    <Login />
  </div>;

  // Unmount on sign-out and reset in-session reports when the account changes.
  return <ReportWorkspace key={session?.user.id ?? 'unconfigured'} session={session}
    onSignOut={signOut} signingOut={signingOut} authError={authError} />;
}

function ReportWorkspace({ session, onSignOut, signingOut, authError }: {
  session: Session | null; onSignOut: () => Promise<void>; signingOut: boolean; authError: string;
}) {
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
        {session && <button type="button" className="pill" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>}
      </div>
      {authError && <p className="prototype-notice" role="alert">{authError}</p>}
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
