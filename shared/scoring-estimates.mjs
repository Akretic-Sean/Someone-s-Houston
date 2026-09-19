import { scoreNeighborhoods, validateScoringPayload, ScoringValidationError, DEFAULT_WEIGHTS } from './scoring.mjs';

export const ESTIMATE_POLICY = 'source-bounded-v1';
const RENT_SOURCE = 'https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf';
const FLOOD_SOURCE = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';

/** Same eight weights/formula; only reviewed missing metrics receive a labeled conservative input. */
export function scoreNeighborhoodsWithEstimates(envelope, options, now = Date.now()) {
  const bad = message => { throw new ScoringValidationError('INVALID_ESTIMATE_INPUT', message); };
  if (!envelope || envelope.schema_version !== 1 || envelope.policy_version !== ESTIMATE_POLICY || !Array.isArray(envelope.estimates) || envelope.estimates.length > 6) bad('Invalid bounded-input response');
  const base = validateScoringPayload(envelope.base);
  // Validate options, time and original cohort before any replacement.
  scoreNeighborhoods(base, options, now);
  const copy = structuredClone(base), seen = new Set(), used = [];
  for (const e of envelope.estimates) {
    if (!e || seen.has(e.neighborhood_id) || !Number.isInteger(e.neighborhood_id)) bad('Duplicate or invalid estimate ID');
    seen.add(e.neighborhood_id);
    const rent = e.neighborhood_id === 7 && e.category_id === 'afford' && e.metric === 'rent_usd';
    const flood = [17,25,41,43,80].includes(e.neighborhood_id) && e.category_id === 'flood' && e.metric === 'sfha_area_pct';
    if ((!rent && !flood) || e.method !== 'conservative_upper_bound' ||
        !Number.isFinite(e.lower_bound) || !Number.isFinite(e.upper_bound) || e.lower_bound < 0 || e.lower_bound > e.upper_bound || e.ranking_value !== e.upper_bound ||
        (rent && (e.lower_bound !== 1500 || e.upper_bound !== 1999 || e.source_url !== RENT_SOURCE)) ||
        (flood && (e.upper_bound > 100 || e.upper_bound - e.lower_bound > 5 || e.source_url !== FLOOD_SOURCE)) ||
        !/^[a-f0-9]{64}$/.test(e.source_sha256) || typeof e.source_period !== 'string' || !e.source_period ||
        typeof e.limitation !== 'string' || !e.limitation || !/^coh-sn-boundaries-[a-f0-9]{16}$/.test(e.boundary_version)) bad('Unreviewed or malformed estimate');
    const checked = Date.parse(e.source_checked_at), due = Date.parse(e.refresh_due_at);
    if (!Number.isFinite(checked) || !Number.isFinite(due) || due <= checked || due - checked > 31*86400000 || checked > now+300000) bad('Invalid estimate dates');
    const row = copy.neighborhoods.find(r => r.neighborhood_id === e.neighborhood_id);
    const category = row.categories[e.category_id];
    // Expired, superseded or already-observed inputs are never replaced.
    if (due <= now || e.base_evidence_version !== category.evidence_version ||
        !['partial','reference_snapshot'].includes(category.availability) || Date.parse(category.refresh_due_at) <= now ||
        category.metrics[e.metric] !== null || (rent && options.tenure !== 'rent') || options.weights[e.category_id] === 0) continue;
    category.metrics[e.metric] = e.ranking_value;
    category.refresh_due_at = new Date(Math.min(due, Date.parse(category.refresh_due_at))).toISOString();
    used.push(structuredClone(e));
  }
  const result = scoreNeighborhoods(copy, options, now);
  for (const row of result.results) {
    row.estimateInputsUsed = used.filter(e => e.neighborhood_id === row.neighborhoodId);
    row.dataQuality = row.estimateInputsUsed.length ? 'includes_conservative_bound' : 'reference_measurements';
    for (const e of row.estimateInputsUsed) {
      const c = row.categories[e.category_id];
      c.measurement = e.category_id === 'afford'
        ? `Conservative gross-rent ranking input $${e.upper_bound}/month from the published $${e.lower_bound}–$${e.upper_bound} band (ACS 2020–2024). Exact median unavailable; not current asking rent.`
        : `Conservative mapped-SFHA upper bound ${e.upper_bound}% (classification interval ${e.lower_bound}–${e.upper_bound}% of neighborhood land/water area). Not a property flood probability.`;
      // Avoid retaining a pre-substitution explanation that calls a bound an observed median/share.
      const prefix = `${c.label}:`;
      row.explanations = row.explanations.map(line => line.startsWith(prefix) ? `${prefix} ${c.score.toFixed(1)}/100 relative score. ${c.measurement}` : line);
    }
  }
  return { ...result, policyVersion: ESTIMATE_POLICY, estimateInputsUsed: used,
    notice: 'All selected priorities retained. Some neighborhoods use labeled conservative bounds derived from official data. Original missing observations remain unknown; this is not an exact-data repair.' };
}

/** Validate the complete envelope without replacing any original observations. */
export function validateBoundedScoringPayload(envelope, now = Date.now()) {
  scoreNeighborhoodsWithEstimates(envelope, {
    weights: DEFAULT_WEIGHTS, tenure: 'rent', mode: 'offer', office: 'ion', airport: 'nearest',
  }, now);
  return envelope;
}
