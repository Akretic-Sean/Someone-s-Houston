import {
  CATEGORY_IDS,
  type Category,
  type CategoryId,
  type CategoryView,
  type Destination,
  type EvidencePayload,
  type WithheldReason,
} from './types';

/**
 * The display gate.
 *
 * `docs/frontend-backend-handoff.md`: before using facts, require
 * `availability` to be `partial` or `reference_snapshot`, non-null facts, and a
 * future `refresh_due_at`. Anything else is withheld with a stated reason —
 * never silently replaced, and never backfilled from the mock.
 */

const DISPLAYABLE = new Set(['partial', 'reference_snapshot']);

export function categoryWithheldReason(
  category: Category | null | undefined,
  now = Date.now(),
): WithheldReason | null {
  if (!category) return 'unavailable';
  if (category.availability === 'needs_refresh') return 'needs_refresh';
  if (!DISPLAYABLE.has(category.availability)) return 'unavailable';
  if (!category.facts) return 'no_facts';
  if (category.refresh_due_at) {
    const due = Date.parse(category.refresh_due_at);
    if (Number.isFinite(due) && due <= now) return 'expired';
  }
  return null;
}

export function buildCategoryViews(
  payload: EvidencePayload,
  now = Date.now(),
): CategoryView[] {
  const neighborhood = payload.neighborhoods[0];
  const defs = new Map(payload.category_definitions.map((d) => [d.id, d]));

  return CATEGORY_IDS.map((id) => {
    const category = neighborhood?.categories?.[id] ?? null;
    const def = defs.get(id);
    return {
      id,
      label: def?.label ?? id,
      defaultWeight: def?.default_weight ?? 0,
      category,
      withheld: categoryWithheldReason(category, now),
    };
  });
}

export const WITHHELD_TEXT: Record<WithheldReason, string> = {
  unavailable: 'Not available from the published data.',
  needs_refresh: 'Withheld: the source data is due a refresh.',
  expired: 'Withheld: this evidence passed its refresh deadline.',
  no_facts: 'Not available from the published data.',
};

/**
 * Flood carries a second, inner availability. Exposure shares may only be
 * shown when it reads `reference_summary` and the values are non-null.
 */
export function floodDisplayable(category: Category | null): boolean {
  const f = category?.facts;
  if (!f) return false;
  if (f.availability !== 'reference_summary') return false;
  return (
    typeof f.sfha_area_pct === 'number' &&
    typeof f.annual_0_2_pct_area_pct === 'number' &&
    typeof f.floodway_area_pct === 'number'
  );
}

export function findDestination(
  category: Category | null,
  id: string,
): Destination | null {
  return category?.facts?.destinations?.find((d) => d.id === id) ?? null;
}

/** Straight-line only. Minutes stay unavailable; never divide by a speed. */
export function formatMeters(meters: number | null | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return 'Unavailable';
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export function formatUsd(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `$${Math.round(value).toLocaleString('en-US')}`
    : 'Unavailable';
}

export function formatPct(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(value < 10 ? 1 : 0)}%`
    : 'Unavailable';
}

/** "Unknown" rather than today's date when a source has no observation period. */
export function sourcePeriod(period: string | null | undefined): string {
  return period && period.trim() ? period : 'Observation period unknown';
}

/** Only render links we can vouch for; anything else shows as plain text. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export type { CategoryId };
