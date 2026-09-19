import { useState } from 'react';
import { Card } from '../components/Bits';
import { DEMO_CANDIDATES, DEMO_REPORTS, demoInsights, type DemoReport } from '../data/demoWorkspace';
import { OFFICES, WEIGHT_DEFS } from '../data/offices';

export default function DemoWorkspace({ nav, onNav, onCalculate, loading, error }: {
  nav: string; onNav: (nav: string) => void; onCalculate: (report: DemoReport) => void; loading: boolean; error: string;
}) {
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const selected = DEMO_REPORTS.find(r => r.id === reportId);
  const selectedCandidate = DEMO_CANDIDATES.find(c => c.id === candidateId);
  const insights = demoInsights();
  function showCandidate(id: string) { setCandidateId(id); setReportId(null); onNav('Candidates'); }
  function showReport(report: DemoReport) { setReportId(report.id); setCandidateId(report.candidateId); onNav('Reports'); }
  const reports = candidateId ? DEMO_REPORTS.filter(r => r.candidateId === candidateId) : DEMO_REPORTS;
  return <section aria-label="Synthetic demo workspace">
    <p className="prototype-notice">Synthetic demo: fictional candidates, scenarios, and activity. These records are local examples, not Supabase customer records. Calculate a scenario to use current Houston evidence.</p>
    {error && <p role="alert">{error}</p>}
    <h1 className="greeting">Demo {nav.toLowerCase()}</h1>
    <div className="kpis">
      <Card><div className="kpi-label">Demo candidates</div><div className="kpi-value">{insights.candidates}</div></Card>
      <Card><div className="kpi-label">Demo reports</div><div className="kpi-value">{insights.reports}</div></Card>
      <Card><div className="kpi-label">Simulated viewed reports</div><div className="kpi-value">{insights.viewed}</div></Card>
    </div>
    {nav === 'Candidates' && <div className="connectors">{DEMO_CANDIDATES.map(candidate => <Card key={candidate.id}>
      <h2>{candidate.name}</h2><p>{candidate.role} · {candidate.city}</p><p>{candidate.goal}</p>
      <button className="btn" onClick={() => { setCandidateId(candidate.id); setReportId(null); onNav('Reports'); }}>View {DEMO_REPORTS.filter(r => r.candidateId === candidate.id).length} reports for {candidate.name}</button>
    </Card>)}</div>}
    {nav === 'Insights' && <div className="connectors">
      <Card><h2>Compare housing choices</h2><p>{insights.comparisons.length} demo candidate has multiple scenarios. Compare rent and buy preferences before choosing a shortlist.</p>
        {insights.comparisons.map(c => <button key={c.id} className="btn" onClick={() => { setCandidateId(c.id); setReportId(null); onNav('Reports'); }}>Compare {c.name}'s reports</button>)}
      </Card>
      <Card><h2>Remote work changes the matrix</h2><p>{insights.remote.length} demo report excludes commute from ranking. Housing and lifestyle priorities still apply.</p>
        {insights.remote.map(r => <button key={r.id} className="btn" onClick={() => showReport(r)}>Inspect {r.title}</button>)}
      </Card>
      <Card><h2>Simulated engagement</h2><p>{insights.viewed} of {insights.reports} demo reports have Viewed status. This is an illustration, not measured customer activity.</p>
        <button className="btn" onClick={() => { setCandidateId(null); setReportId(null); onNav('Reports'); }}>See all demo reports</button>
      </Card>
    </div>}
    {nav === 'Reports' && <>
      {candidateId && <p>Reports for {selectedCandidate?.name} <button className="btn" onClick={() => { setCandidateId(null); setReportId(null); }}>Show all demo reports</button></p>}
      <Card><div className="table-wrap"><table><thead><tr><th>Scenario</th><th>Candidate</th><th>Housing</th><th>Simulated status</th></tr></thead><tbody>
        {reports.map(report => <tr key={report.id}><td><button className="btn" onClick={() => showReport(report)}>{report.scenario}</button></td>
          <td><button className="btn" onClick={() => showCandidate(report.candidateId)}>{DEMO_CANDIDATES.find(c => c.id === report.candidateId)?.name}</button></td><td>{report.config.tenure}</td><td>{report.status}</td></tr>)}
      </tbody></table></div></Card>
      {selected && <Card><h2>{selected.title}</h2><p>Office hub: {OFFICES.find(o => o.id === selected.config.office)?.label}. Mode: {selected.config.mode}. Housing: {selected.config.tenure}.</p>
        <p>Highest configured priorities: {WEIGHT_DEFS.filter(w => selected.config.mode !== 'remote' || w.id !== 'commute').sort((a,b) => selected.config.weights[b.id] - selected.config.weights[a.id]).slice(0,3).map(w => w.label).join(', ')}.</p>
        <p>This synthetic scenario has no invented neighborhood scores. Calculate to fetch current Supabase evidence; it will not create a saved customer report.</p>
        <button className="btn btn-primary" disabled={loading} onClick={() => onCalculate(selected)}>{loading ? 'Calculating…' : 'Calculate with live Houston evidence'}</button>
      </Card>}
    </>}
    {!['Reports', 'Candidates', 'Insights'].includes(nav) && <p>Choose Reports, Candidates, or Insights to explore the linked demo.</p>}
  </section>;
}
