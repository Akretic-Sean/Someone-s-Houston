import type { NeighborhoodProfile } from './neighborhoodApi';
import type { Neighborhood, ResolvedNeighborhood } from '../types';

/** Parses "$210,000" / "$185,000" as entered by the recruiter. */
export function parseSalary(value: string): number | null {
  const digits = value.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Joins the report's neighborhoods onto the live reference layer by
 * `neighborhood_id` — the City's POLYID — never by name.
 *
 * A neighborhood with no matching row is dropped rather than rendered with
 * invented figures. `docs/api.md`: never replace missing values with zero.
 */
export function resolveNeighborhoods(
  picks: Neighborhood[],
  rows: NeighborhoodProfile[],
  salary: number | null,
): ResolvedNeighborhood[] {
  const byId = new Map(rows.map((r) => [r.neighborhood_id, r]));

  return picks.flatMap((pick) => {
    const row = byId.get(pick.neighborhoodId);
    if (!row) return [];

    const income = row.median_household_income;
    return [
      {
        ...pick,
        // The City's own name is authoritative; it is title-cased for display.
        name: titleCase(row.name),
        lat: row.centroid_lat,
        lon: row.centroid_lon,
        medianGrossRent: row.median_gross_rent,
        medianHouseholdIncome: income,
        medianHomeValue: row.median_home_value,
        standing: salary !== null && income !== null && income > 0 ? salary / income : null,
        live: true,
      },
    ];
  });
}

/** "NEARTOWN - MONTROSE" reads badly in a headline. */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, 'of');
}

export function formatRent(value: number | null): string {
  return value === null
    ? 'Rent unavailable'
    : `Median gross rent $${value.toLocaleString('en-US')} / mo`;
}
