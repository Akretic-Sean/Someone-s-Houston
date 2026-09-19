const CATEGORY_IDS = ['afford', 'commute', 'flood', 'amen', 'fit', 'food', 'air', 'health'];
const DISPLAYABLE = new Set(['partial', 'reference_snapshot']);

function deadline(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const time = Date.parse(value);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (hour > 23 || minute > 59 || second > 59 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return NaN;
  return time;
}

/** Source facts fail closed when freshness cannot be established. */
export function categoryWithheldReason(category, now = Date.now()) {
  if (!category) return 'unavailable';
  if (category.availability === 'needs_refresh') return 'needs_refresh';
  if (!DISPLAYABLE.has(category.availability)) return 'unavailable';
  if (!category.facts) return 'no_facts';
  const due = deadline(category.refresh_due_at);
  if (!Number.isFinite(due)) return 'needs_refresh';
  return due <= now ? 'expired' : null;
}

/** Never pair cached ranking facts with a different evidence publication. */
export function evidenceMatchesScoring(evidenceNeighborhood, scoringNeighborhood) {
  if (!evidenceNeighborhood || !scoringNeighborhood || evidenceNeighborhood.neighborhood_id !== scoringNeighborhood.neighborhood_id) return false;
  return CATEGORY_IDS.every(id => {
    const actual = evidenceNeighborhood.categories?.[id]?.evidence_version;
    const expected = scoringNeighborhood.categories?.[id]?.evidence_version;
    return typeof actual === 'string' && actual.length > 0 && actual === expected;
  });
}
