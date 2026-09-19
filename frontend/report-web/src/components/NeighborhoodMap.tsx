import { useMemo, useState } from 'react';
import type { ScoredNeighborhood, ScoringNeighborhood } from '../../../../shared/scoring.mjs';
import type { Office } from '../types';

const PAD = 0.055;

export default function NeighborhoodMap({ rows, picks, office, hovered, onHover, onSelect }: {
  rows: ScoringNeighborhood[];
  picks: ScoredNeighborhood[];
  office: Office | null;
  hovered: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
}) {
  const project = useMemo(() => {
    const lats = rows.map(row => row.reference_point.latitude);
    const lons = rows.map(row => row.reference_point.longitude);
    if (office) { lats.push(office.lat); lons.push(office.lon); }
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    return (lat: number, lon: number) => ({
      x: (PAD + (lon - minLon) / Math.max(maxLon - minLon, 1e-6) * (1 - 2 * PAD)) * 100,
      y: (PAD + (1 - (lat - minLat) / Math.max(maxLat - minLat, 1e-6)) * (1 - 2 * PAD)) * 100,
    });
  }, [rows, office]);
  const [flipped, setFlipped] = useState(false);
  const pickIds = new Set(picks.map(pick => pick.neighborhoodId));
  const officePoint = office ? project(office.lat, office.lon) : null;
  return (
    <figure className="map-figure">
      <div className="map" onMouseLeave={() => onHover(null)}>
        <span className="map-note">88 SUPER NEIGHBORHOODS · REFERENCE POINTS · NOT TO SCALE</span>
        {rows.filter(row => !pickIds.has(row.neighborhood_id)).map(row => {
          const point = project(row.reference_point.latitude, row.reference_point.longitude);
          return <button key={row.neighborhood_id} type="button" className="map-ctx map-context-button"
            style={{ left: `${point.x}%`, top: `${point.y}%` }} title={row.name}
            aria-label={`View evidence for ${row.name}`} onClick={() => onSelect(row.neighborhood_id)} />;
        })}
        {office && officePoint && <span className="map-pin map-pin-office" style={{ left: `${officePoint.x}%`, top: `${officePoint.y}%` }} title={office.label}><span className="map-dot" /></span>}
        {picks.map(neighborhood => {
          const point = project(neighborhood.referencePoint.latitude, neighborhood.referencePoint.longitude);
          const active = hovered === neighborhood.neighborhoodId;
          return <button key={neighborhood.neighborhoodId} type="button" className="map-pin map-pin-pick"
            data-pin={neighborhood.neighborhoodId} data-active={active}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            onMouseEnter={event => { setFlipped(event.currentTarget.getBoundingClientRect().top < 190); onHover(neighborhood.neighborhoodId); }}
            onFocus={event => { setFlipped(event.currentTarget.getBoundingClientRect().top < 190); onHover(neighborhood.neighborhoodId); }}
            onBlur={() => onHover(null)} onClick={() => onSelect(neighborhood.neighborhoodId)}
            aria-label={`Rank ${neighborhood.rank}: ${neighborhood.name}. View evidence.`}
            aria-describedby={active ? `map-tip-${neighborhood.neighborhoodId}` : undefined}>
            <span className="map-dot">{neighborhood.rank}</span>
            {active && <span className="map-tip" data-flip={flipped} id={`map-tip-${neighborhood.neighborhoodId}`} role="tooltip">
              <span className="map-tip-name">{neighborhood.name}</span>
              <span className="map-tip-row"><span>Relative score</span><strong>{neighborhood.totalScore?.toFixed(1)} / 100</strong></span>
              <span className="source">Select to inspect the source evidence.</span>
            </span>}
          </button>;
        })}
      </div>
      <ul className="map-legend">{picks.map(neighborhood => <li key={neighborhood.neighborhoodId}>
        <button type="button" data-active={hovered === neighborhood.neighborhoodId}
          onMouseEnter={() => onHover(neighborhood.neighborhoodId)} onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(neighborhood.neighborhoodId)} onBlur={() => onHover(null)}
          onClick={() => onSelect(neighborhood.neighborhoodId)}>
          <span className="map-legend-dot">{neighborhood.rank}</span>{neighborhood.name}
        </button>
      </li>)}
        {office && <li className="map-legend-office"><span className="map-legend-dot map-legend-dot-office" />{office.label}</li>}
      </ul>
      <figcaption className="source">City of Houston neighborhood reference points. This schematic shows relative placement, not boundaries, parcels or driving routes. Every point can open its evidence; unranked neighborhoods stay on the map.</figcaption>
    </figure>
  );
}
