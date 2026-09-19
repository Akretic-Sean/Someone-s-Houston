import type { BoundedScoringResult } from '../../../../shared/scoring-estimates.mjs';
import type { ReportConfig } from '../App';
import { Card, Segmented } from '../components/Bits';
import { DEFAULT_WEIGHTS, OFFICES, WEIGHT_DEFS } from '../data/offices';
import PreferenceNotes from '../components/PreferenceNotes';

export default function CreateReport({ config, onChange, result, loading, generating, extracting, onExtracting, error, onRetry, onGenerate }: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
  result: BoundedScoringResult | null;
  loading: boolean;
  generating: boolean;
  extracting: boolean;
  onExtracting: (busy: boolean) => void;
  error: string | null;
  onRetry: () => void;
  onGenerate: () => Promise<void>;
}) {
  const weights = { ...config.weights, commute: config.mode === 'remote' ? 0 : config.weights.commute };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <main className="create"><div className="shell">
      <h1 className="section-title">Configure and generate</h1>
      <p className="section-lede">Choose what matters to you. We compare Houston’s 88 Super Neighborhoods using published evidence and your weights. Scores are provisional relative comparisons. Public safety context appears separately in your report and is not scored.</p>
      <fieldset className="scoring-form" disabled={generating || extracting}>
        <PreferenceNotes profile={config.profile} onChange={profile => onChange({ ...config, profile })} onBusy={onExtracting} />
        <div className="config-grid">
          <Card>
            <div className="field-row">
              <span className="eyebrow">Work arrangement</span>
              <Segmented label="Comparison mode" value={config.mode} onChange={mode => onChange({ ...config, mode })}
                options={[{ id: 'offer', label: 'Office / offer mode' }, { id: 'remote', label: 'Fully remote' }]} />
              {config.mode === 'remote' && <p className="source">Commute is excluded. The other priorities are renormalized to 100%.</p>}
            </div>
            <div className="field-row">
              <span className="eyebrow">Housing</span>
              <Segmented label="Housing" value={config.tenure} onChange={tenure => onChange({ ...config, tenure })}
                options={[{ id: 'rent', label: 'Rent' }, { id: 'buy', label: 'Buy' }]} />
              <p className="source">Affordability compares ACS 2020–2024 {config.tenure === 'rent' ? 'median monthly gross rents, with a labeled conservative input where the exact median is unavailable' : 'median home values'}. It does not estimate your payment or budget.</p>
            </div>
            <div className="field-row">
              <span className="eyebrow">Office hub</span>
              <div className="offices">{OFFICES.map(office => (
                <button key={office.id} type="button" className="office" disabled={config.mode === 'remote'}
                  aria-pressed={config.office === office.id} onClick={() => onChange({ ...config, office: office.id })}>
                  <span className="office-label">{office.label}</span><br /><span className="office-sub">{office.sub}</span>
                </button>
              ))}</div>
            </div>
            <div className="field-row" style={{ marginBottom: 0 }}>
              <span className="eyebrow">Airport</span>
              <Segmented label="Airport preference" value={config.airport} onChange={airport => onChange({ ...config, airport })}
                options={[{ id: 'nearest', label: 'Nearest airport' }, { id: 'iah', label: 'IAH' }, { id: 'hou', label: 'Hobby / HOU' }]} />
              <p className="source">Office and airport scores use straight-line proximity. Driving times and traffic are not available.</p>
            </div>
          </Card>
          <Card>
            <div className="sec-head"><span className="eyebrow">Priority weights</span>
              <button type="button" className="pill" onClick={() => onChange({ ...config, weights: { ...DEFAULT_WEIGHTS } })}>Reset</button>
            </div>
            <div style={{ height: 12 }} />
            {WEIGHT_DEFS.map(weight => (
              <div className="weight" key={weight.id}>
                <div className="weight-head"><label htmlFor={`w-${weight.id}`}>{weight.label}</label>
                  <span className="weight-pct">{totalWeight > 0 ? Math.round(weights[weight.id] / totalWeight * 100) : 0}%</span>
                </div>
                <input id={`w-${weight.id}`} type="range" min={0} max={10} step={1}
                  value={weights[weight.id]} disabled={config.mode === 'remote' && weight.id === 'commute'}
                  aria-valuetext={`${weights[weight.id]} out of 10 priority`}
                  onChange={event => onChange({ ...config, weights: { ...config.weights, [weight.id]: Number(event.target.value) } })} />
              </div>
            ))}
          </Card>
        </div>
      </fieldset>
      <div className="scoring-status" aria-live="polite">
        {totalWeight === 0 ? <p className="form-error" role="alert">Choose at least one priority above zero. Fully remote mode does not count commute.</p>
          : loading ? <p><span className="spinner" /> Loading current scoring evidence…</p>
          : result ? <p><strong>{result.ranked.length} of {result.results.length} neighborhoods can be ranked.</strong> {result.unranked.length > 0 ? `${result.unranked.length} have missing evidence for a selected priority and remain visible without a total score.` : 'All selected priorities are included.'}</p> : null}
        {result && !loading && result.estimateInputsUsed.length > 0 && <p className="source">{result.estimateInputsUsed.length} neighborhoods include conservative source-derived estimates. Their ranges and sources appear in the report; original missing observations remain unknown.</p>}
        {error && <div role="alert"><p className="form-error">{error}</p><button type="button" className="btn" onClick={onRetry}>Retry data connection</button></div>}
        {result && !loading && totalWeight > 0 && <p className="source">Current leaders: {result.ranked.slice(0, 3).map(row => row.name).join(' · ') || 'None with complete selected evidence'}. Changing priorities recalculates locally.</p>}
      </div>
      <button type="button" className="btn btn-primary" disabled={generating || extracting || loading || totalWeight === 0 || !result?.ranked.length || Boolean(error)} onClick={() => { void onGenerate(); }}>
        {generating ? 'Generating your report…' : 'Generate report'}
      </button>
      <p className="source" style={{ marginTop: 14 }}>Priorities, housing mode, workplace hub and airport choice determine this ranking. Reports stay in this browser session; no candidate record is saved.</p>
    </div></main>
  );
}
