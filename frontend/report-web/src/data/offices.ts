import type { Office, WeightDef } from '../types';

/**
 * Office presets. Tech jobs in Houston cluster around its industries, so the
 * recruiter picks a hub rather than typing an address.
 */
export const OFFICES: Office[] = [
  { id: 'ion', label: 'The Ion / Midtown', sub: 'Innovation district', lat: 29.7264, lon: -95.382 },
  { id: 'downtown', label: 'Downtown', sub: 'Central business district', lat: 29.7589, lon: -95.3677 },
  { id: 'energy', label: 'Energy Corridor', sub: 'West Houston, I-10', lat: 29.7836, lon: -95.6392 },
  { id: 'tmc', label: 'Texas Medical Center', sub: 'Health and research', lat: 29.7096, lon: -95.398 },
  { id: 'nasa', label: 'NASA / Clear Lake', sub: 'Southeast, aerospace', lat: 29.559, lon: -95.09 },
];

export const WEIGHT_DEFS: WeightDef[] = [
  { id: 'afford', label: 'Affordability', value: 8 },
  { id: 'commute', label: 'Commute', value: 7 },
  { id: 'flood', label: 'Flood context', value: 6 },
  { id: 'amen', label: 'Local amenities', value: 5 },
  { id: 'fit', label: 'Fitness and recreation', value: 7 },
  { id: 'food', label: 'Dining and grocery access', value: 8 },
  { id: 'air', label: 'Airport access', value: 6 },
  { id: 'health', label: 'Healthcare access', value: 7 },
];

export const DEFAULT_WEIGHTS = Object.fromEntries(
  WEIGHT_DEFS.map((w) => [w.id, w.value]),
) as Record<WeightDef['id'], number>;
