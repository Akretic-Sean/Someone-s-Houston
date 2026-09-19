import { useMemo, useState } from 'react';
import type { NeighborhoodProfile } from '../data/neighborhoodApi';
import type { Office, ResolvedNeighborhood } from '../types';

/**
 * All 88 Super Neighborhoods positioned from their real centroids, with the
 * recommended areas and the office picked out. Hovering or focusing a pin
 * raises the matching card, and vice versa — `hovered` is owned by the report.
 *
 * Equirectangular projection. At Houston's latitude that is close enough for
 * relative placement, which is all this is for; it is not a navigational map.
 */

const PAD = 0.055;

interface Point {
  x: number;
  y: number;
}

function useProjection(rows: NeighborhoodProfile[], office: Office) {
  return useMemo(() => {
    const lats = [...rows.map((r) => r.centroid_lat), office.lat];
    const lons = [...rows.map((r) => r.centroid_lon), office.lon];
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Longitude degrees shrink with latitude; without this Houston looks stretched.
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.cos((midLat * Math.PI) / 180);

    const spanLat = Math.max(maxLat - minLat, 1e-6);
    const spanLon = Math.max((maxLon - minLon) * lonScale, 1e-6);

    return (lat: number, lon: number): Point => {
      const nx = ((lon - minLon) * lonScale) / spanLon;
      const ny = (lat - minLat) / spanLat;
      return {
        x: (PAD + nx * (1 - 2 * PAD)) * 100,
        // Screen y grows downward; north should be up.
        y: (PAD + (1 - ny) * (1 - 2 * PAD)) * 100,
      };
    };
  }, [rows, office]);
}

function money(value: number | null) {
  return value === null ? 'Unavailable' : `$${value.toLocaleString('en-US')}`;
}

export default function NeighborhoodMap({
  rows,
  picks,
  office,
  hovered,
  onHover,
  sourceLabel,
}: {
  rows: NeighborhoodProfile[];
  picks: ResolvedNeighborhood[];
  office: Office;
  hovered: string | null;
  onHover: (id: string | null) => void;
  sourceLabel: string;
}) {
  const project = useProjection(rows, office);
  // Tooltips sit above the pin, but the report's sticky bar would cover one
  // raised near the top of the viewport, so those flip below instead. Measured
  // at hover time because it depends on scroll, not on map geometry.
  const [flipped, setFlipped] = useState(false);
  const STICKY_CLEARANCE = 190;
  const pickIds = new Set(picks.map((p) => p.neighborhoodId));
  const officePoint = project(office.lat, office.lon);

  function pinNearTop(id: string): boolean {
    const el = document.querySelector(`[data-pin="${id}"]`);
    return el ? el.getBoundingClientRect().top < STICKY_CLEARANCE : false;
  }

  return (
    <figure className="map-figure">
      <div className="map" onMouseLeave={() => onHover(null)}>
        <span className="map-note">
          88 SUPER NEIGHBORHOODS · CENTROIDS · NOT TO SCALE
        </span>

        {/* Context layer: every neighborhood the City publishes. */}
        {rows
          .filter((r) => !pickIds.has(r.neighborhood_id))
          .map((r) => {
            const p = project(r.centroid_lat, r.centroid_lon);
            return (
              <span
                key={r.neighborhood_id}
                className="map-ctx"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={r.name}
                aria-hidden="true"
              />
            );
          })}

        <span
          className="map-pin map-pin-office"
          style={{ left: `${officePoint.x}%`, top: `${officePoint.y}%` }}
          title={office.label}
        >
          <span className="map-dot" />
        </span>

        {picks.map((n, i) => {
          const p = project(n.lat, n.lon);
          const active = hovered === n.id;
          return (
            <button
              key={n.id}
              type="button"
              className="map-pin map-pin-pick"
              data-pin={n.id}
              data-active={active}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              onMouseEnter={(e) => {
                setFlipped(e.currentTarget.getBoundingClientRect().top < STICKY_CLEARANCE);
                onHover(n.id);
              }}
              onFocus={(e) => {
                setFlipped(e.currentTarget.getBoundingClientRect().top < STICKY_CLEARANCE);
                onHover(n.id);
              }}
              onBlur={() => onHover(null)}
              onClick={() => onHover(active ? null : n.id)}
              aria-describedby={active ? `map-tip-${n.id}` : undefined}
            >
              <span className="map-dot">{i + 1}</span>
              <span className="sr-only">{n.name}</span>

              {active ? (
                <span
                  className="map-tip"
                  data-flip={flipped}
                  id={`map-tip-${n.id}`}
                  role="tooltip"
                >
                  <span className="map-tip-name">{n.name}</span>
                  <span className="map-tip-row">
                    <span>Median household income</span>
                    <strong>{money(n.medianHouseholdIncome)}</strong>
                  </span>
                  <span className="map-tip-row">
                    <span>Median gross rent</span>
                    <strong>
                      {n.medianGrossRent === null
                        ? 'Unavailable'
                        : `${money(n.medianGrossRent)} / mo`}
                    </strong>
                  </span>
                  <span className="map-tip-row">
                    <span>Median home value</span>
                    <strong>{money(n.medianHomeValue)}</strong>
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ul className="map-legend">
        {picks.map((n, i) => (
          <li key={n.id}>
            <button
              type="button"
              data-active={hovered === n.id}
              onMouseEnter={() => {
                setFlipped(pinNearTop(n.id));
                onHover(n.id);
              }}
              onFocus={() => {
                setFlipped(pinNearTop(n.id));
                onHover(n.id);
              }}
              onMouseLeave={() => onHover(null)}
              onBlur={() => onHover(null)}
            >
              <span className="map-legend-dot">{i + 1}</span>
              {n.name}
            </button>
          </li>
        ))}
        <li className="map-legend-office">
          <span className="map-legend-dot map-legend-dot-office" />
          {office.label}
        </li>
      </ul>

      <figcaption className="source">
        Source: {sourceLabel}. Centroids locate a neighborhood, not a parcel or a
        driving route.
      </figcaption>
    </figure>
  );
}
