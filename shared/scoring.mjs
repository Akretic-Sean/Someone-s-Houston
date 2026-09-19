/**
 * Pure, browser-safe neighborhood comparison model. No network, database, keys,
 * routing assumptions or candidate data are used here. See docs/scoring-matrix.md.
 */
export const MODEL_VERSION = 'houston-proximity-v1';
export const CATEGORY_IDS = Object.freeze(['afford', 'commute', 'flood', 'amen', 'fit', 'food', 'air', 'health']);
export const DEFAULT_WEIGHTS = Object.freeze({ afford: 8, commute: 7, flood: 6, amen: 5, fit: 7, food: 8, air: 6, health: 7 });

const METRICS = Object.freeze({
  afford: ['rent_usd', 'home_value_usd'],
  commute: ['ion', 'downtown', 'energy', 'tmc', 'nasa'],
  flood: ['sfha_area_pct'],
  amen: ['libraries', 'museums', 'community_centers', 'multi_service_centers'],
  fit: ['parks', 'community_centers'],
  food: ['grocery_stores'],
  air: ['iah', 'hou'],
  health: ['hospitals', 'health_facilities', 'multi_service_centers'],
});
const USABLE = new Set(['reference_snapshot', 'partial']);
const AVAILABILITIES = new Set([...USABLE, 'unavailable', 'needs_refresh']);
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = (value, max = 256) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export class ScoringValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScoringValidationError';
    this.code = code;
  }
}

function requireValue(condition, code, message) {
  if (!condition) throw new ScoringValidationError(code, message);
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const time = Date.parse(value);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) return NaN;
  // Date.parse normalizes some invalid calendar dates (for example February 30).
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day ? time : NaN;
}

/** Validate the complete, versioned cohort. Does not mutate or trim the payload. */
export function validateScoringPayload(payload) {
  const bad = message => requireValue(false, 'INVALID_PAYLOAD', message);
  if (!object(payload) || payload.schema_version !== 1 || payload.model_version !== MODEL_VERSION) bad('Unsupported neighborhood scoring schema or model version.');
  if (!Number.isFinite(timestamp(payload.evaluated_at))) bad('The scoring snapshot has an invalid evaluation timestamp.');
  if (!Array.isArray(payload.category_definitions) || payload.category_definitions.length !== CATEGORY_IDS.length) bad('The scoring snapshot must define all eight categories.');
  const categoryIds = new Set();
  for (const definition of payload.category_definitions) {
    if (!object(definition) || !CATEGORY_IDS.includes(definition.id) || categoryIds.has(definition.id) || !validText(definition.label) || definition.default_weight !== DEFAULT_WEIGHTS[definition.id]) bad('The scoring snapshot has invalid category definitions.');
    categoryIds.add(definition.id);
  }
  if (!Array.isArray(payload.neighborhoods) || payload.neighborhoods.length !== 88) bad('Scoring requires the complete 88-neighborhood reference cohort.');
  const ids = new Set();
  const versions = new Set();
  for (const row of payload.neighborhoods) {
    if (!object(row) || !Number.isInteger(row.neighborhood_id) || row.neighborhood_id < 1 || row.neighborhood_id > 88 || ids.has(row.neighborhood_id) || !validText(row.name)) bad('The scoring snapshot contains an invalid or duplicate neighborhood.');
    ids.add(row.neighborhood_id);
    const point = row.reference_point;
    if (!object(point) || !Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 || !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) bad(`Neighborhood ${row.neighborhood_id} has an invalid reference point.`);
    if (!object(row.categories) || Object.keys(row.categories).length !== CATEGORY_IDS.length) bad(`Neighborhood ${row.neighborhood_id} must contain all eight categories.`);
    for (const id of CATEGORY_IDS) {
      const category = row.categories[id];
      if (!own(row.categories, id) || !object(category) || !AVAILABILITIES.has(category.availability)) bad(`Neighborhood ${row.neighborhood_id} has invalid ${id} availability.`);
      const absent = category.availability === 'unavailable';
      if (!(absent && category.refresh_due_at === null) && !Number.isFinite(timestamp(category.refresh_due_at))) bad(`Neighborhood ${row.neighborhood_id} has an invalid ${id} refresh deadline.`);
      if (!(absent && category.evidence_version === null) && !validText(category.evidence_version, 128)) bad(`Neighborhood ${row.neighborhood_id} has an invalid ${id} evidence version.`);
      if (category.evidence_version !== null) versions.add(category.evidence_version);
      if (!object(category.metrics) || Object.keys(category.metrics).length !== METRICS[id].length) bad(`Neighborhood ${row.neighborhood_id} has invalid ${id} metrics.`);
      for (const key of METRICS[id]) {
        const value = category.metrics[key];
        if (!own(category.metrics, key) || !(value === null || (Number.isFinite(value) && value >= 0 && (id !== 'flood' || value <= 100)))) bad(`Neighborhood ${row.neighborhood_id} has an invalid ${id}.${key} measurement.`);
        if (id === 'afford' && value !== null && value === 0) bad(`Neighborhood ${row.neighborhood_id} has a zero housing cost; unknown costs must be null.`);
      }
    }
  }
  if (versions.size > 1) bad('The scoring snapshot mixes evidence versions. Refresh the complete snapshot before ranking.');
  return payload;
}

function validateOptions(options) {
  requireValue(object(options), 'INVALID_OPTIONS', 'Choose the report preferences before scoring.');
  requireValue(['rent', 'buy'].includes(options.tenure) && ['offer', 'remote'].includes(options.mode) && METRICS.commute.includes(options.office) && ['iah', 'hou', 'nearest'].includes(options.airport), 'INVALID_OPTIONS', 'Choose a valid housing mode, work mode, office hub and airport.');
  requireValue(object(options.weights) && Object.keys(options.weights).length === CATEGORY_IDS.length && CATEGORY_IDS.every(id => own(options.weights, id) && Number.isFinite(options.weights[id]) && options.weights[id] >= 0 && options.weights[id] <= 10), 'INVALID_WEIGHTS', 'Provide all eight priority weights as numbers from 0 to 10.');
}

function selectedMetrics(id, metrics, options) {
  if (id === 'afford') {
    const field = options.tenure === 'rent' ? 'rent_usd' : 'home_value_usd';
    return { [field]: metrics[field] };
  }
  if (id === 'commute') return { [options.office]: metrics[options.office] };
  if (id === 'air' && options.airport !== 'nearest') return { [options.airport]: metrics[options.airport] };
  if (id === 'air') return { nearest_airport_meters: metrics.iah === null || metrics.hou === null ? null : Math.min(metrics.iah, metrics.hou) };
  return { ...metrics };
}

function measurement(id, options) {
  return {
    afford: options.tenure === 'rent' ? 'ACS 2020–2024 estimated median monthly gross rent; lower is favored, without a personal budget calculation' : 'ACS 2020–2024 estimated median home value; lower is favored, without a mortgage or ownership-cost calculation',
    commute: `Straight-line proximity to the selected ${options.office} office-hub proxy; not travel time`,
    flood: 'Lower mapped 1%-annual-chance flood-zone area share; not a property flood probability',
    amen: 'Equal-weighted proximity to libraries, museums, community centers and multiservice centers',
    fit: 'Equal-weighted proximity to parks and community centers; gym and trail coverage is not included',
    food: 'Proximity to the covered SNAP-authorized grocery inventory; dining is not included',
    air: `Straight-line proximity to ${options.airport === 'nearest' ? 'the nearer IAH/HOU airport proxy' : `the ${options.airport.toUpperCase()} airport proxy`}; not travel time`,
    health: 'Equal-weighted proximity to hospitals, health facilities and multiservice centers; not insurance, clinical quality or appointment availability',
  }[id];
}

function unavailableReason(category, metrics, now) {
  if (!USABLE.has(category.availability)) return category.availability === 'needs_refresh' ? 'Source evidence needs refresh.' : 'Source evidence is unavailable.';
  if (timestamp(category.refresh_due_at) <= now) return 'Source evidence has expired; refresh it before scoring.';
  const missing = Object.entries(metrics).filter(([, value]) => value === null).map(([key]) => key);
  return missing.length ? `Missing required measurement${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` : null;
}

/** Lower-is-better percentile with average ranks for ties and neutral constants. */
function percentile(value, cohort) {
  if (cohort.length <= 1) return 50;
  let worse = 0;
  let equal = 0;
  for (const candidate of cohort) {
    if (candidate > value) worse++;
    else if (candidate === value) equal++;
  }
  return 100 * (worse + (equal - 1) / 2) / (cohort.length - 1);
}

/**
 * Scores the fixed reference cohort. Missing positively weighted categories
 * exclude a total, never redistribute weights or become favorable zeroes.
 */
export function scoreNeighborhoods(input, options, now = Date.now()) {
  const payload = validateScoringPayload(input);
  validateOptions(options);
  requireValue(Number.isFinite(now) && Math.abs(now) <= 8.64e15, 'INVALID_TIME', 'A valid comparison time is required.');
  requireValue(timestamp(payload.evaluated_at) <= now + 5 * 60 * 1000, 'INVALID_PAYLOAD', 'The scoring snapshot evaluation time is in the future.');
  const effectiveWeights = { ...options.weights, commute: options.mode === 'remote' ? 0 : options.weights.commute };
  const totalWeight = CATEGORY_IDS.reduce((sum, id) => sum + effectiveWeights[id], 0);
  requireValue(totalWeight > 0, 'NO_ACTIVE_WEIGHTS', options.mode === 'remote' ? 'Choose at least one non-commute priority. Commute is excluded in remote mode.' : 'Choose at least one priority with a weight above zero.');
  const normalizedWeights = Object.fromEntries(CATEGORY_IDS.map(id => [id, effectiveWeights[id] / totalWeight]));
  const labels = Object.fromEntries(payload.category_definitions.map(category => [category.id, category.label]));
  const cohort = {};
  let currentCategories = 0;
  for (const id of CATEGORY_IDS) {
    cohort[id] = {};
    for (const row of payload.neighborhoods) {
      const category = row.categories[id];
      if (!USABLE.has(category.availability) || timestamp(category.refresh_due_at) <= now) continue;
      currentCategories++;
      // A missing sibling component does not remove this valid component from
      // its reference cohort. Cohorts do not depend on other weights or totals.
      for (const [key, value] of Object.entries(selectedMetrics(id, category.metrics, options))) {
        cohort[id][key] ??= [];
        if (value !== null) cohort[id][key].push(value);
      }
    }
  }
  requireValue(currentCategories > 0, 'NO_CURRENT_DATA', 'No current scoring evidence is available. Refresh the data before generating a report.');
  const results = payload.neighborhoods.map(row => {
    const categories = {};
    for (const id of CATEGORY_IDS) {
      const source = row.categories[id];
      const selected = selectedMetrics(id, source.metrics, options);
      const reason = unavailableReason(source, selected, now);
      const scores = reason === null ? Object.entries(selected).map(([key, value]) => percentile(value, cohort[id][key])) : [];
      const score = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
      categories[id] = {
        score, weight: effectiveWeights[id], normalizedWeight: normalizedWeights[id],
        contribution: score === null ? null : score * normalizedWeights[id],
        // Do not return stale facts even when the caller retains the snapshot.
        metrics: USABLE.has(source.availability) && timestamp(source.refresh_due_at) > now ? selected : Object.fromEntries(Object.keys(selected).map(key => [key, null])),
        reason, label: labels[id], measurement: measurement(id, options),
      };
    }
    const missingCategories = CATEGORY_IDS.filter(id => effectiveWeights[id] > 0 && categories[id].score === null);
    const totalScore = missingCategories.length ? null : CATEGORY_IDS.reduce((sum, id) => sum + (effectiveWeights[id] === 0 ? 0 : categories[id].contribution), 0);
    const explanations = CATEGORY_IDS.filter(id => effectiveWeights[id] > 0 && categories[id].score !== null)
      .sort((a, b) => categories[b].contribution - categories[a].contribution || CATEGORY_IDS.indexOf(a) - CATEGORY_IDS.indexOf(b))
      .slice(0, 3)
      .map(id => `${labels[id]}: ${categories[id].score.toFixed(1)}/100 relative comparison score. ${categories[id].measurement}.`);
    return {
      neighborhoodId: row.neighborhood_id, name: row.name,
      referencePoint: { ...row.reference_point }, rank: null, totalScore,
      categories, missingCategories, explanations,
    };
  }).sort((a, b) => a.neighborhoodId - b.neighborhoodId);
  const ranked = results.filter(row => row.totalScore !== null).sort((a, b) => b.totalScore - a.totalScore || a.neighborhoodId - b.neighborhoodId);
  ranked.forEach((row, index) => { row.rank = index + 1; });
  return {
    modelVersion: MODEL_VERSION, evaluatedAt: new Date(now).toISOString(),
    effectiveWeights, normalizedWeights, ranked,
    unranked: results.filter(row => row.totalScore === null), results,
  };
}
