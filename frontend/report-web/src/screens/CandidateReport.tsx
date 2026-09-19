import { useMemo, useState } from 'react';
import { CATEGORY_IDS, type ScoredNeighborhood, type ScoringPayload, type ScoringResult } from '../../../../shared/scoring.mjs';
import type { ReportConfig } from '../App';
import { Card } from '../components/Bits';
import NeighborhoodMap from '../components/NeighborhoodMap';
import { OFFICES, WEIGHT_DEFS } from '../data/offices';
import EvidenceCards from '../evidence/EvidenceCards';
import { useEvidence } from '../evidence/useEvidence';
import { clearEvidenceCache } from '../evidence/api';
import { evidenceMatchesScoring } from '../evidence/validity.mjs';
import { buildCategoryViews, formatMeters, formatPct, formatUsd } from '../evidence/select';
import ListingWatchDialog from '../watch/ListingWatchDialog';
import type { Narrative } from '../data/reportFlow';

const METRIC_LABELS: Record<string, string> = {
  rent_usd: 'Estimated monthly rent', home_value_usd: 'Estimated home value', sfha_area_pct: 'Area in mapped flood hazard zone',
  ion: 'Ion / Midtown', downtown: 'Downtown', energy: 'Energy Corridor', tmc: 'Texas Medical Center', nasa: 'NASA / Clear Lake',
  iah: 'IAH', hou: 'Hobby / HOU', nearest_airport_meters: 'Nearest airport',
  libraries: 'Library', museums: 'Museum', community_centers: 'Community center', multi_service_centers: 'Multiservice center',
  parks: 'Park', grocery_stores: 'Covered grocery', hospitals: 'Hospital', health_facilities: 'Health facility',
};

function measurementValue(category: string, key: string, value: number | null) {
  if (value === null) return 'Unavailable';
  if (category === 'afford') return `${formatUsd(value)}${key === 'rent_usd' ? ' / mo' : ''}`;
  if (category === 'flood') return formatPct(value);
  return `${formatMeters(value)} straight-line`;
}

function ScoreBreakdown({ neighborhood }: { neighborhood: ScoredNeighborhood }) {
  return <div className="scoring-table-wrap"><table className="scoring-table">
    <caption>Category scores and contributions for {neighborhood.name}</caption>
    <thead><tr><th scope="col">Category / evidence used</th><th scope="col">Weight</th><th scope="col">Score</th><th scope="col">Points</th></tr></thead>
    <tbody>{CATEGORY_IDS.map(id => {
      const category = neighborhood.categories[id];
      return <tr key={id}><th scope="row"><div>{category.label}</div>
        <div className="source">{category.measurement}</div>
        <div className="score-measurements">{Object.entries(category.metrics).map(([key, value]) =>
          <span key={key}>{METRIC_LABELS[key] ?? key}: {measurementValue(id, key, value)}</span>)}</div>
        {category.reason && <div className="source">{category.reason}</div>}
      </th>
        <td>{Math.round(category.normalizedWeight * 100)}%</td>
        <td>{category.score === null ? 'Unavailable' : category.score.toFixed(1)}</td>
        <td>{category.weight === 0 ? 'Not weighted' : category.contribution === null ? 'Unavailable' : category.contribution.toFixed(1)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function NeighborhoodCard({ neighborhood, hovered, onHover, onSelect }: {
  neighborhood: ScoredNeighborhood; hovered: number | null;
  onHover: (id: number | null) => void; onSelect: (id: number) => void;
}) {
  const rent = neighborhood.categories.afford.metrics.rent_usd;
  const home = neighborhood.categories.afford.metrics.home_value_usd;
  return <Card className={hovered === neighborhood.neighborhoodId ? 'hood-card hood-card-active' : 'hood-card'}
    onMouseEnter={() => onHover(neighborhood.neighborhoodId)} onMouseLeave={() => onHover(null)}>
    <div className="hood-head"><div><div className="hood-rank">#{neighborhood.rank} relative match</div><h3 className="hood-name">{neighborhood.name}</h3></div>
      <div className="hood-score">{neighborhood.totalScore?.toFixed(1)}<span> / 100</span></div>
    </div>
    <div className="tags">
      {typeof rent === 'number' && <span className="tag">{formatUsd(rent)} / mo estimated median rent</span>}
      {typeof home === 'number' && <span className="tag">{formatUsd(home)} estimated median home value</span>}
      <span className="tag">Provisional comparison</span>
    </div>
    <ul className="score-reasons">{neighborhood.explanations.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <details className="score-details"><summary>Why this ranked here</summary><ScoreBreakdown neighborhood={neighborhood} /></details>
    <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => onSelect(neighborhood.neighborhoodId)}>View sources and local facilities</button>
  </Card>;
}

export default function CandidateReport({ config, result, payload, narrative, now, loading, error, onRetry, onConfigure }: {
  config: ReportConfig; result: ScoringResult | null; payload: ScoringPayload | null; loading: boolean;
  error: string | null; onRetry: () => void; onConfigure: () => void;
  narrative: Narrative | null; now: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchMessage, setWatchMessage] = useState('');
  // Correlation identifier for this browser session, not a persisted report ID.
  const [watchReportId] = useState(() => `session-${crypto.randomUUID()}`);
  const activeId = selectedId ?? result?.ranked[0]?.neighborhoodId ?? null;
  const evidence = useEvidence(activeId);
  const active = result?.results.find(row => row.neighborhoodId === activeId);
  const office = OFFICES.find(item => item.id === config.office) ?? OFFICES[0];
  const scoringNeighborhood = payload?.neighborhoods.find(row => row.neighborhood_id === activeId);
  const detailNeighborhood = evidence.payload?.neighborhoods[0];
  const matchingEvidence = detailNeighborhood?.neighborhood_id === activeId && evidenceMatchesScoring(detailNeighborhood, scoringNeighborhood);
  const evidenceVersionMismatch = detailNeighborhood?.neighborhood_id === activeId && !matchingEvidence;
  const views = matchingEvidence && evidence.payload ? buildCategoryViews(evidence.payload).map(view => ({ ...view, label: WEIGHT_DEFS.find(def => def.id === view.id)?.label ?? view.label })) : [];
  const top = useMemo(() => result?.ranked.slice(0, 5) ?? [], [result]);
  const watchPicks = useMemo(() => (result?.ranked.slice(0, 5) ?? []).map(row => ({ neighborhoodId: row.neighborhoodId, name: row.name })), [result]);

  function select(id: number) {
    setSelectedId(id);
    document.getElementById('neighborhood-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function refreshReportEvidence() {
    clearEvidenceCache();
    onRetry();
    evidence.retry();
  }

  return <>
    <div className="report-bar">
      <span className="wordmark">Someone’s <em>Houston</em></span>
      <span className="source">Provisional neighborhood comparison</span>
      <button type="button" className="btn" onClick={onConfigure}>Adjust priorities</button>
      <button type="button" className="btn" onClick={() => window.print()}>Print / PDF</button>
      <button type="button" className="btn btn-primary" disabled={loading || Boolean(error) || watchPicks.length === 0} onClick={() => setWatchOpen(true)}>Listing Watch</button>
    </div>
    {watchMessage && <p className="prototype-notice" role="status">{watchMessage}</p>}
    <main className="report-body">
      {loading ? <Card><p role="status"><span className="spinner" /> Checking current scoring evidence…</p></Card>
        : error || !result || !payload ? <Card><p role="alert">{error ?? 'Scoring evidence is unavailable.'}</p><button className="btn" onClick={onRetry}>Retry data connection</button></Card>
        : <>
          <section className="hero">
            <span className="eyebrow">Your neighborhood comparison</span>
            <h1>Find your <em>Houston.</em></h1>
            <p>Ranked from published neighborhood evidence using your chosen priorities. These relative scores help build a shortlist; they do not predict your personal experience.</p>
            <div className="facts">
              <Card><div className="fact-label">Housing comparison</div><div className="fact-value">{config.tenure === 'rent' ? 'Rent' : 'Buy'}</div></Card>
              <Card><div className="fact-label">Work arrangement</div><div className="fact-value">{config.mode === 'remote' ? 'Fully remote' : office.label}</div></Card>
              <Card><div className="fact-label">Airport preference</div><div className="fact-value">{config.airport === 'nearest' ? 'Nearest of IAH / HOU' : config.airport.toUpperCase()}</div></Card>
              <Card><div className="fact-label">Comparable neighborhoods</div><div className="fact-value">{result.ranked.length} / {result.results.length}</div></Card>
            </div>
            <div className="tags">{WEIGHT_DEFS.map(def => <span className="tag" key={def.id}>{def.label}: {Math.round(result.normalizedWeights[def.id] * 100)}%</span>)}</div>
            {config.mode === 'remote' && <p className="source">Commute is excluded in fully remote mode. Remaining priorities are renormalized.</p>}
          </section>
          <section aria-label="Report explanation">
            <Card>
              <h2 className="section-title">Your report at a glance</h2>
              {narrative?.status === 'generated' && narrative.text && Date.parse(narrative.expiresAt) > now
                ? <><p className="ai-narrative">{narrative.text}</p><p className="source">AI-assisted explanation of the computed ranking. Review the supporting facts below.</p>
                  <details><summary>Supporting report facts</summary><ul className="score-reasons">{narrative.facts.map(fact => <li key={fact.id}>
                    <strong>{fact.label}:</strong> {fact.value}<div className="source">{fact.source}</div>
                  </li>)}</ul></details></>
                : <p className="source">Showing the factual report without an AI explanation. The ranking, scores and evidence below remain available.</p>}
            </Card>
          </section>
          <section>
            <h2 className="section-title">Top neighborhood matches</h2>
            <p className="section-lede">Showing the highest {top.length} scores among neighborhoods with every positively weighted measurement available. Missing measurements are never treated as zero or rewarded.</p>
            <NeighborhoodMap rows={payload.neighborhoods} picks={top} office={config.mode === 'remote' ? null : office} hovered={hovered} onHover={setHovered} onSelect={select} />
            <div className="scored-neighborhoods">{top.map(neighborhood => <NeighborhoodCard key={neighborhood.neighborhoodId} neighborhood={neighborhood} hovered={hovered} onHover={setHovered} onSelect={select} />)}</div>
          </section>
          <section>
            <h2 className="section-title">All neighborhoods</h2>
            <p className="section-lede">Open any area’s source evidence, including areas with insufficient data.</p>
            <details className="score-details"><summary>View all {result.ranked.length} ranked neighborhoods</summary>
              <ol className="ranked-neighborhood-list">{result.ranked.map(row => <li key={row.neighborhoodId}>
                <button type="button" onClick={() => select(row.neighborhoodId)}>{row.name}<span>{row.totalScore?.toFixed(1)} / 100</span></button>
              </li>)}</ol>
            </details>
            {result.unranked.length > 0 && <Card className="unranked-card"><span className="eyebrow">Insufficient data · {result.unranked.length} areas</span>
              <ul>{result.unranked.map(row => <li key={row.neighborhoodId}><button type="button" className="text-button" onClick={() => select(row.neighborhoodId)}>{row.name}</button>
                <span> — {row.missingCategories.map(id => WEIGHT_DEFS.find(def => def.id === id)?.label ?? id).join(', ')} unavailable; no total score.</span>
              </li>)}</ul>
            </Card>}
          </section>
          <section id="neighborhood-evidence" style={{ scrollMarginTop: 150 }}>
            <div className="sec-head"><h2 className="section-title">Evidence for {active?.name ?? 'a neighborhood'}</h2></div>
            <label className="field evidence-select">Choose neighborhood
              <select value={activeId ?? ''} onChange={event => setSelectedId(Number(event.target.value))}>
                {result.results.map(row => <option key={row.neighborhoodId} value={row.neighborhoodId}>{row.name}{row.rank === null ? ' — insufficient data' : ` — #${row.rank}`}</option>)}
              </select>
            </label>
            {active && <details className="score-details"><summary>Full score breakdown{active.rank === null ? ' — total withheld' : ` — ${active.totalScore?.toFixed(1)} / 100`}</summary><ScoreBreakdown neighborhood={active} /></details>}
            <p className="section-lede">Category measurements come from the source snapshots below. Model scores are calculated separately from those facts. Safety and driving times remain unavailable.</p>
            {evidence.loading ? <Card><p role="status"><span className="spinner" /> Loading source evidence…</p></Card>
              : evidence.error ? <Card><p role="alert">Source details could not be read: {evidence.error.message}</p><button className="btn" onClick={evidence.retry}>Retry evidence</button></Card>
              : evidenceVersionMismatch ? <Card><p role="alert">The detailed evidence and ranking use different data versions. Details are withheld until both are refreshed.</p><button type="button" className="btn" onClick={refreshReportEvidence}>Refresh ranking and evidence</button></Card>
              : views.length > 0 ? <EvidenceCards views={views} officeId={config.office} airportId={config.airport} weights={result.effectiveWeights} /> : null}
          </section>
          <section>
            <h2 className="section-title">How to read this report</h2>
            <Card><ul className="scoring-method">
              <li>Each measurement becomes a lower-is-better percentile across the neighborhoods with that measurement available. Ties share a score. Multi-facility categories average the same fixed facility measurements for every neighborhood.</li>
              <li>The total is the sum of category scores multiplied by your normalized weights. Only display values are rounded. Equal totals use the City neighborhood ID as a stable tie-break.</li>
              <li>Affordability uses ACS 2020–2024 estimates. It does not account for your income, mortgage, taxes, insurance or current listings.</li>
              <li>Commute, airports, recreation and facility access use straight-line distances from neighborhood reference points. They do not establish travel time, walkability, openings or quality.</li>
              <li>Grocery access covers SNAP-authorized stores in the imported inventory. Restaurant preferences are not scored. Flood scores compare mapped land-area exposure, not the chance a particular home floods.</li>
              <li>There is no safety tier, automated financial comparison, lead submission or saved shareable report in this version.</li>
            </ul></Card>
          </section>
          <footer className="report-footer">
            <span className="eyebrow">Sources and transparency</span>
            <p>City of Houston neighborhood profiles and facilities · ACS 2020–2024 · FEMA mapped flood hazard areas · USDA SNAP retailer inventory · verified destination reference points. Source links and periods appear with the detailed evidence.</p>
            <p>Model: {result.modelVersion}. Evidence checked by the API: {new Date(payload.evaluated_at).toLocaleString()}. This timestamp is a validity check, not the observation date of every source.</p>
          </footer>
        </>}
    </main>
    <ListingWatchDialog open={watchOpen} onClose={() => setWatchOpen(false)} reportId={watchReportId}
      officeId={config.office} picks={watchPicks} onDone={setWatchMessage} />
  </>;
}
