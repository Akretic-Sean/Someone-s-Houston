import type { NearbyAccess, ScoredCategory } from '../../../../shared/scoring.mjs';
import { Card } from '../components/Bits';
import {
  WITHHELD_TEXT,
  findDestination,
  floodDisplayable,
  formatMeters,
  formatPct,
  formatUsd,
  safeHref,
  sourcePeriod,
} from './select';
import type { Category, CategoryId, CategoryView, Inventory } from './types';

/**
 * The eight evidence categories.
 *
 * Every value here is a fact from `get_neighborhood_evidence`, shown with its
 * source, or it is explicitly withheld. Nothing falls back to the mock report.
 * Scores and the safety tier are not rendered at all: the RPC returns null for
 * both, with `score_status: "not_implemented"`.
 */

function Fact({ label, value }: { label: string; value: string }) {
  const unknown = value === 'Unavailable';
  return (
    <div className="ev-fact">
      <span className="ev-fact-label">{label}</span>
      <span className="ev-fact-value" data-unknown={unknown}>
        {value}
      </span>
    </div>
  );
}

function Sources({ category }: { category: Category }) {
  const sources = category.sources ?? [];
  if (sources.length === 0) return null;
  return (
    <div className="ev-sources">
      {sources.map((s) => {
        const href = safeHref(s.source_url);
        return (
          <div key={s.source_id} className="source">
            Source: {href ? (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {s.source_id}
              </a>
            ) : (
              s.source_id
            )}{' '}
            · {sourcePeriod(s.source_period)}
          </div>
        );
      })}
    </div>
  );
}

function Caveats({ category }: { category: Category }) {
  const missing = category.missing_inputs ?? [];
  const limits = category.limitations ?? [];
  if (missing.length === 0 && limits.length === 0) return null;
  return (
    <details className="ev-caveats">
      <summary>What this does not tell you</summary>
      {limits.length > 0 ? (
        <ul>
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {missing.length > 0 ? (
        <>
          <div className="ev-caveat-head">Not supplied</div>
          <ul>
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
  );
}

function InventoryList({
  inventories,
  keys,
  nearbyAccess,
}: {
  inventories: Record<string, Inventory> | null | undefined;
  keys: string[];
  nearbyAccess?: NearbyAccess | null;
}) {
  if (!inventories) return <Fact label="Inventory" value="Unavailable" />;
  return (
    <>
      <p className="ev-note">{nearbyAccess ? 'Facilities within 3 miles of the neighborhood reference point, including across neighborhood boundaries. Closer facilities contribute more to the score.' : 'Facility counts inside the neighborhood boundary. These are counts, not access scores.'}</p>
      {keys.map((key) => {
        const inv = inventories[key];
        const count = nearbyAccess ? nearbyAccess.facilities[key]?.count : inv?.record_count_in_neighborhood;
        return (
          <Fact
            key={key}
            label={key.replace(/_/g, ' ')}
            // Zero records is a fact; a missing count is not.
            value={typeof count === 'number' ? String(count) : 'Unavailable'}
          />
        );
      })}
      <p className="ev-note">{nearbyAccess ? 'Nearest facilities are listed below for context. Only those within 3 miles contribute to this access score.' : 'Nearby facilities, including those outside the boundary, contribute to proximity scores.'} Distances are straight-line from the neighborhood reference point, not travel distances from a home.</p>
      {keys.flatMap((key) => {
        const nearest = inventories[key]?.nearest_to_reference_point ?? [];
        return nearest.slice(0, 3).map((p) => (
          <div key={p.place_id} className="ev-place">
            <span className="ev-place-name">{p.name}</span>
            <span className="ev-place-meta">
              {formatMeters(p.straight_line_meters)}
              {p.inside_neighborhood === false ? ' · outside this neighborhood' : ''}
            </span>
          </div>
        ));
      })}
    </>
  );
}

function Body({
  view,
  officeId,
  airportId,
  nearbyAccess,
}: {
  view: CategoryView;
  officeId: string;
  airportId: string;
  nearbyAccess?: NearbyAccess | null;
}) {
  const category = view.category;
  if (!category?.facts) return null;
  const f = category.facts;

  switch (view.id) {
    case 'afford': {
      const stock = f.housing_stock;
      return (
        <>
          <Fact label="Median gross rent" value={typeof f.median_gross_rent_monthly_usd === 'number' ? `${formatUsd(f.median_gross_rent_monthly_usd)} / mo` : 'Unavailable'} />
          <Fact label="Median home value" value={formatUsd(f.median_home_value_usd)} />
          <Fact
            label="Total housing units"
            value={
              typeof stock?.total_housing_units === 'number'
                ? stock.total_housing_units.toLocaleString('en-US')
                : 'Unavailable'
            }
          />
          {stock?.shares_pct
            ? Object.entries(stock.shares_pct)
                .slice(0, 4)
                .map(([k, v]) => (
                  <Fact key={k} label={k.replace(/_/g, ' ')} value={formatPct(v)} />
                ))
            : null}
          <p className="ev-note">
            Estimated medians, not asking prices or a mortgage payment. Housing shares are
            separate marginal estimates and are not combined into listing counts.
          </p>
        </>
      );
    }

    case 'commute': {
      const dest = findDestination(category, officeId);
      if (!dest) return <Fact label="Selected office" value="Unavailable" />;
      return (
        <>
          <Fact label={dest.label} value={formatMeters(dest.straight_line_meters)} />
          <Fact label="Drive time" value="Unavailable" />
          {dest.address ? <p className="ev-note">{dest.address}</p> : null}
          <p className="ev-note">
            Straight-line from the neighborhood reference point. Route minutes are not
            published, and distance is never converted into a travel time.
            {dest.note ? ` ${dest.note}` : ''}
          </p>
        </>
      );
    }

    case 'flood': {
      if (!floodDisplayable(category)) {
        return (
          <p className="ev-note">
            Mapped flood exposure is not published for this neighborhood.
          </p>
        );
      }
      return (
        <>
          <Fact label="In special flood hazard area" value={formatPct(f.sfha_area_pct)} />
          <Fact label="0.2% annual-chance zone" value={formatPct(f.annual_0_2_pct_area_pct)} />
          <Fact label="In mapped floodway" value={formatPct(f.floodway_area_pct)} />
          <Fact label="Zone coverage" value={formatPct(f.mapped_zone_coverage_pct)} />
          <p className="ev-note">
            Shares of neighborhood area. The 0.2% band excludes the hazard area, and the
            floodway is already inside it, so these do not sum. This is not a probability
            for any individual home. Panels effective {f.panel_effective_date_min ?? 'unknown'} to{' '}
            {f.panel_effective_date_max ?? 'unknown'}.
          </p>
        </>
      );
    }

    case 'amen':
      return (
        <>
          <InventoryList
            inventories={f.inventories}
            keys={['libraries', 'museums', 'community_centers', 'multi_service_centers']}
            nearbyAccess={nearbyAccess}
          />
          <p className="ev-note">
            Counts per category. These overlap, so they are not added into a single total
            of unique sites.
          </p>
        </>
      );

    case 'fit':
      return (
        <>
          <InventoryList inventories={f.inventories} keys={['parks', 'community_centers']} />
          <p className="ev-note">
            Parks and centers only. Gyms, trail coverage, entrances and walkability are not
            published.
          </p>
        </>
      );

    case 'food':
      return (
        <>
          <InventoryList inventories={f.inventories} keys={['grocery_stores']} />
          <p className="ev-note">
            SNAP-authorized grocery inventory. Restaurants and dietary suitability are not
            published.
          </p>
        </>
      );

    case 'air': {
      const airports = ['iah', 'hou'].map(id => findDestination(category, id));
      return (
        <>
          {airports.map((destination, index) => <Fact key={index} label={destination?.label ?? ['IAH', 'Hobby / HOU'][index]} value={formatMeters(destination?.straight_line_meters)} />)}
          <Fact label="Drive time" value="Unavailable" />
          <p className="ev-note">
            Scoring uses {airportId === 'nearest' ? 'the nearer airport' : airportId.toUpperCase()}. Straight-line to an airport reference point. Flights, schedules and noise are
            not published.
          </p>
        </>
      );
    }

    case 'health':
      return (
        <>
          <InventoryList
            inventories={f.inventories}
            keys={['hospitals', 'health_facilities', 'multi_service_centers']}
            nearbyAccess={nearbyAccess}
          />
          <p className="ev-note">
            Facility locations only — not insurance acceptance, appointment availability or
            quality.
          </p>
        </>
      );

    default:
      return null;
  }
}

export default function EvidenceCards({
  views,
  officeId,
  airportId,
  weights,
  scoredCategories,
}: {
  views: CategoryView[];
  officeId: string;
  airportId: string;
  weights: Record<CategoryId, number>;
  scoredCategories?: Record<CategoryId, ScoredCategory>;
}) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <div className="ev-grid">
      {views.map((view) => (
        <Card key={view.id} className="ev-card">
          <div className="ev-head">
            <span className="eyebrow">{view.label}</span>
            {total > 0 ? (
              <span className="ev-weight">
                {Math.round((weights[view.id] / total) * 100)}% priority
              </span>
            ) : null}
          </div>

          {view.withheld ? (
            <p className="ev-withheld">{WITHHELD_TEXT[view.withheld]}</p>
          ) : (
            <>
              <Body view={view} officeId={officeId} airportId={airportId} nearbyAccess={scoredCategories?.[view.id].nearbyAccess} />
              <Caveats category={view.category!} />
              <Sources category={view.category!} />
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
