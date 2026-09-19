import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ScoredNeighborhood, ScoringNeighborhood } from '../../../../shared/scoring.mjs';
import { fetchNeighborhoodBoundaries, type NeighborhoodBoundaries } from '../data/boundaryApi';
import type { Office } from '../types';

export default function NeighborhoodMap({ rows, picks, office, hovered, onHover, onSelect }: {
  rows: ScoringNeighborhood[];
  picks: ScoredNeighborhood[];
  office: Office | null;
  hovered: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const handlers = useRef({ onHover, onSelect });
  handlers.current = { onHover, onSelect };
  const [boundaries, setBoundaries] = useState<NeighborhoodBoundaries>();
  const [boundaryError, setBoundaryError] = useState(false);
  const [boundaryAttempt, setBoundaryAttempt] = useState(0);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    let active = true;
    setBoundaryError(false);
    fetchNeighborhoodBoundaries().then(data => { if (active) setBoundaries(data); })
      .catch(() => { if (active) setBoundaryError(true); });
    return () => { active = false; };
  }, [boundaryAttempt]);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false, maxZoom: 18, minZoom: 8 });
    map.current = instance;
    // Leaflet projects both WGS84 points and GeoJSON onto the tiles' Web Mercator grid.
    const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(instance);
    tiles.current = layer;
    layer.on('tileerror', () => setTileError(true));
    L.control.scale({ imperial: true, metric: true }).addTo(instance);
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    const beforePrint = () => instance.invalidateSize();
    window.addEventListener('beforeprint', beforePrint);
    return () => {
      resize.disconnect();
      window.removeEventListener('beforeprint', beforePrint);
      instance.remove();
      map.current = null;
      tiles.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const group = L.layerGroup().addTo(instance);
    const selected = new Map(picks.map(pick => [pick.neighborhoodId, pick]));
    markers.current.clear();
    for (const row of rows) {
      const pick = selected.get(row.neighborhood_id);
      const label = pick ? `Rank ${pick.rank}: ${row.name}. View evidence.` : `View evidence for ${row.name}`;
      const dot = document.createElement('span');
      dot.className = pick ? 'geo-dot geo-dot-pick' : 'geo-dot';
      dot.textContent = pick ? String(pick.rank) : '';
      const marker = L.marker([row.reference_point.latitude, row.reference_point.longitude], {
        icon: L.divIcon({ className: 'geo-marker', html: dot, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: label, alt: label, riseOnHover: true, zIndexOffset: pick ? 1000 : 0,
      }).addTo(group);
      const tooltip = document.createElement('span');
      tooltip.textContent = pick ? `${row.name} · ${pick.totalScore?.toFixed(1)} / 100` : row.name;
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -10] });
      marker.on('click', () => handlers.current.onSelect(row.neighborhood_id));
      marker.on('mouseover', () => handlers.current.onHover(row.neighborhood_id));
      marker.on('mouseout', () => handlers.current.onHover(null));
      const element = marker.getElement();
      if (element) {
        element.setAttribute('aria-label', label);
        element.dataset.neighborhoodId = String(row.neighborhood_id);
        if (pick) element.dataset.pin = String(row.neighborhood_id);
        element.addEventListener('focus', () => handlers.current.onHover(row.neighborhood_id));
        element.addEventListener('blur', () => handlers.current.onHover(null));
        element.addEventListener('keydown', event => {
          // Leaflet handles Enter; provide Space as well for button semantics.
          if (event.key === ' ') { event.preventDefault(); handlers.current.onSelect(row.neighborhood_id); }
        });
      }
      markers.current.set(row.neighborhood_id, marker);
    }
    if (office) {
      const dot = document.createElement('span');
      dot.className = 'geo-dot geo-dot-office';
      const tooltip = document.createElement('span');
      tooltip.textContent = office.label;
      L.marker([office.lat, office.lon], {
        icon: L.divIcon({ className: 'geo-marker', html: dot, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: office.label, keyboard: false, zIndexOffset: 1500,
      }).bindTooltip(tooltip).addTo(group);
    }
    return () => { group.remove(); markers.current.clear(); };
  }, [rows, picks, office]);

  useEffect(() => {
    for (const [id, marker] of markers.current) {
      marker.getElement()?.setAttribute('data-active', String(id === hovered));
      if (id === hovered) marker.openTooltip(); else marker.closeTooltip();
    }
  }, [hovered, rows, picks, office]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !boundaries) return;
    const pickIds = new Set(picks.map(pick => pick.neighborhoodId));
    const layer = L.geoJSON(boundaries, {
      style: feature => ({ color: pickIds.has(feature?.properties.neighborhood_id) ? '#5eead4' : '#94a3b8',
        weight: pickIds.has(feature?.properties.neighborhood_id) ? 2 : 1,
        fillOpacity: pickIds.has(feature?.properties.neighborhood_id) ? 0.15 : 0.015 }),
      onEachFeature: (feature, polygon) => {
        const label = document.createElement('span');
        label.textContent = feature.properties.name;
        polygon.bindTooltip(label);
        polygon.on('click', () => handlers.current.onSelect(feature.properties.neighborhood_id));
      },
    }).addTo(instance);
    return () => { layer.remove(); };
  }, [boundaries, picks]);

  function fitAll() {
    const points: L.LatLngTuple[] = rows.map(row => [row.reference_point.latitude, row.reference_point.longitude]);
    if (office) points.push([office.lat, office.lon]);
    if (points.length) map.current?.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 11, animate: false });
  }
  useEffect(() => { fitAll(); }, [rows, office]);

  function fitMatches() {
    const points: L.LatLngTuple[] = picks.map(pick => [pick.referencePoint.latitude, pick.referencePoint.longitude]);
    if (office) points.push([office.lat, office.lon]);
    if (points.length) map.current?.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 14 });
  }

  return <figure className="map-figure">
    <div className="geo-map-actions">
      <span className="source">Houston · {rows.length} neighborhood reference points</span>
      <button type="button" className="btn btn-sm" onClick={fitAll}>Fit all neighborhoods</button>
      <button type="button" className="btn btn-sm" onClick={fitMatches} disabled={!picks.length}>Zoom to matches</button>
    </div>
    <div ref={container} className="geo-map" role="region" aria-label="Houston neighborhood map" />
    {tileError && <p className="map-status" role="status">Street map tiles could not load. Reference points and available boundaries remain usable.{' '}
      <button type="button" className="btn btn-sm" onClick={() => { setTileError(false); tiles.current?.redraw(); }}>Retry street map</button></p>}
    {boundaryError && <p className="map-status" role="status">Neighborhood boundaries are unavailable. Showing reference points.{' '}
      <button type="button" className="btn btn-sm" onClick={() => setBoundaryAttempt(value => value + 1)}>Retry boundaries</button></p>}
    {!boundaries && !boundaryError && <p className="source" role="status">Loading neighborhood boundaries…</p>}
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
    <figcaption className="source">City of Houston reference points{boundaries ? ' and simplified Super Neighborhood boundaries' : ''} over OpenStreetMap streets.
      Select a marker or boundary to open its evidence. Teal numbers show ranked matches; orange marks the workplace.
      Locations are neighborhood references, not properties or driving routes.</figcaption>
  </figure>;
}
