import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { scoreNeighborhoodsWithEstimates } from '../../../shared/scoring-estimates.mjs';
import Login from './screens/Login';
import { listReports, saveReport, type SavedReport } from './data/savedReports';
import { supabase } from './lib/supabase';
import Dashboard from './screens/Dashboard';
import CreateReport from './screens/CreateReport';
import CandidateReport from './screens/CandidateReport';
import { DEFAULT_CONNECTORS, type ConnectorId, type ConnectorStates } from './data/connectors';
import { DEFAULT_WEIGHTS } from './data/offices';
import { useScoringData } from './hooks/useScoringData';
import { generateAiReport, type GeneratedReport } from './data/reportFlow';
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
  const [generated, setGenerated] = useState<GeneratedReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const generationPending = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [generateError, setGenerateError] = useState<string | null>(null);
  const data = useScoringData();
  const [savedRows, setSavedRows] = useState<SavedReport[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [savedError, setSavedError] = useState('');
  const [demoError, setDemoError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(false);
  const pendingSave = useRef<{ id: string; config: ReportConfig; report: GeneratedReport } | null>(null);
  const rawName = session?.user.user_metadata?.full_name || session?.user.user_metadata?.username || session?.user.user_metadata?.name;
  const displayName = typeof rawName === 'string' && rawName.trim() ? rawName : session?.user.email ?? 'Your account';
  async function loadSaved() {
    if (!session) return;
    setListing(true); setSavedError('');
    try { const result = await listReports(session.user.id); setSavedRows(result.rows); setSavedCount(result.count); }
    catch (error) { setSavedError(error instanceof Error ? error.message : 'Could not load reports.'); }
    finally { setListing(false); }
  }
  useEffect(() => { void loadSaved(); }, []);
  async function persistPending() {
    if (!session || !pendingSave.current || saving) return;
    setSaving(true); setSaveNotice('Saving report…');
    try {
      const pending = pendingSave.current;
      await saveReport(pending.id, session.user.id, pending.config, pending.report);
      pendingSave.current = null; setSaveNotice('Saved to your dashboard.'); void loadSaved();
    } catch (error) { setSaveNotice(error instanceof Error ? error.message : 'Could not save report.'); }
    finally { setSaving(false); }
  }
  async function openSaved(row: SavedReport, demo = false) {
    if (generationPending.current) return;
    generationPending.current = true; setGenerating(true); setSavedError(''); setDemoError('');
    try {
      const payload = await data.refresh();
      scoreNeighborhoodsWithEstimates(payload, row.config);
      if (!row.config.profile || Object.values(row.config.profile).some(value => typeof value !== 'string')) throw new Error('Invalid saved preferences.');
      setConfig(row.config);
      setGenerated({ payload, generatedAt: new Date().toISOString(), narrative: { status: 'degraded', text: null, facts: [], expiresAt: new Date().toISOString() } });
      setSaveNotice(demo ? 'Synthetic candidate scenario calculated using current Supabase evidence. This demo report is not saved.' : 'Saved priorities restored with current evidence. Original generation snapshot is retained privately in Supabase.');
      go('report');
    } catch { (demo ? setDemoError : setSavedError)('Could not load this report with current evidence. Please retry.'); }
    finally { generationPending.current = false; setGenerating(false); }
  }
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const scoring = useMemo(() => {
    if (!data.payload) return { result: null, error: null };
    try { return { result: scoreNeighborhoodsWithEstimates(data.payload, config), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : 'Choose valid priorities.' }; }
  }, [data.payload, data.loadedAt, config, clock]);
  const reportScoring = useMemo(() => {
    if (!generated) return { result: null, error: null };
    try { return { result: scoreNeighborhoodsWithEstimates(generated.payload, config), error: null }; }
    catch { return { result: null, error: 'This report’s evidence has expired. Generate a fresh report.' }; }
  }, [generated, config, clock]);

  function go(next: View) {
    setView(next);
    window.scrollTo(0, 0);
  }

  async function generate(withAi = true) {
    if (generationPending.current || extracting) return;
    generationPending.current = true;
    setGenerating(true);
    setGenerateError(null);
    try {
      const { profile, ...options } = config;
      const report: GeneratedReport = withAi ? await generateAiReport(options, profile) : {
        payload: await data.refresh(), generatedAt: new Date().toISOString(),
        narrative: { status: 'degraded', text: null, facts: [], expiresAt: new Date().toISOString() },
      };
      const result = scoreNeighborhoodsWithEstimates(report.payload, config);
      if (!result.ranked.length) throw new Error('No neighborhoods have all of the evidence needed for these priorities. Review the missing-data details or retry after the data is refreshed.');
      setGenerated(report);
      go('report');
      if (session) { pendingSave.current = { id: crypto.randomUUID(), config, report }; await persistPending(); }
      else setSaveNotice('Sign in to save reports.');
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'Could not generate the report. Please retry.');
    } finally { generationPending.current = false; setGenerating(false); }
  }

  function changeConfig(next: ReportConfig) {
    setConfig(next);
    setGenerated(null);
    setGenerateError(null);
  }

  return (
    <div className="app">
      <div className="proto">
        <span className="proto-label">Someone’s Houston</span>
        <button className="pill" aria-pressed={view === 'create'} disabled={generating || extracting} onClick={() => go('create')}>Configure priorities</button>
        <button className="pill" aria-pressed={view === 'report'} disabled={!generated || generating || extracting} onClick={() => go('report')}>Neighborhood report</button>
        <button className="pill" aria-pressed={view === 'dashboard'} disabled={generating || extracting} onClick={() => go('dashboard')}>My dashboard</button>
        {session && <button type="button" className="pill" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>}
      </div>
      {authError && <p className="prototype-notice" role="alert">{authError}</p>}
      {saveNotice && <p className="prototype-notice" role="status">{saveNotice} {pendingSave.current && <button disabled={saving} onClick={() => void persistPending()}>Retry save</button>}</p>}
      {view === 'dashboard' && <>
        <p className="prototype-notice">Reports are private to your signed-in account. Reopening restores saved priorities using current Supabase evidence. Connector controls remain demonstrations.</p>
        <Dashboard demoError={demoError} displayName={displayName} email={session?.user.email ?? ''} reports={savedRows} count={savedCount} loading={listing || generating} error={savedError} onRetry={() => void loadSaved()} nav={dashboardNav} onNav={setDashboardNav} connectors={connectors}
          onToggleConnector={(id: ConnectorId) => setConnectors(c => ({ ...c, [id]: c[id] === 'connected' ? 'idle' : 'connected' }))}
          onDemoReport={(row) => void openSaved(row, true)} onOpenReport={(row) => void openSaved(row)} onCreate={() => go('create')} />
      </>}
      {view === 'create' && <CreateReport config={config} onChange={changeConfig}
        result={scoring.result} loading={data.loading} generating={generating} extracting={extracting} onExtracting={setExtracting}
        error={generateError ?? data.error ?? scoring.error}
        onRetry={() => { setGenerateError(null); void data.refresh(true).catch(() => {}); }} onGenerate={() => generate(true)} onFactual={() => generate(false)} />}
      {view === 'report' && <CandidateReport config={config} result={reportScoring.result}
        loading={false} error={reportScoring.error} payload={generated?.payload.base ?? null}
        narrative={generated?.narrative ?? null} now={clock}
        onRetry={() => { setGenerated(null); go('create'); }} onConfigure={() => go('create')} />}
    </div>
  );
}
