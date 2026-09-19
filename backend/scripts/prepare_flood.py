"""Prepare bounded FEMA NFHL area summaries. Never writes to Supabase.

Install requirements-flood.txt, then run from any directory:
  python backend/scripts/prepare_flood.py --cache-dir <scratch-directory>
Only the compact summary is published under backend/data. Raw geometries stay
in the explicitly supplied scratch directory. A failed run keeps prior output.
Normal runs always fetch polygon contents. --resume can reuse response caches
younger than one hour and preserves their original content retrieval timestamps.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

BASE = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'
FIELDS = {
    28: 'OBJECTID,DFIRM_ID,FLD_AR_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,SOURCE_CIT',
    3: 'OBJECTID,DFIRM_ID,FIRM_PAN,PANEL_TYP,EFF_DATE,PRE_DATE,PNP_REASON',
    0: 'OBJECTID,STUDY_ID',
    1: 'OBJECTID,DFIRM_ID,LOMR_ID,EFF_DATE,CASE_NO,STATUS',
}
MAX_BYTES = 40_000_000
MAX_LAYER_FEATURES = 25_000
MAX_LAYER_BYTES = 400_000_000
RESUME_MAX_AGE_SECONDS = 3600
# Relative area tolerance for two independently sourced polygon boundaries.
# This is exposed in output; it never silently turns larger gaps into zero risk.
COVERAGE_THRESHOLD = 99.99
PROJECT = Transformer.from_crs('EPSG:4326', 'EPSG:5070', always_xy=True).transform
BACKEND = Path(__file__).resolve().parents[1]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def request(path, params):
    url = path + '?' + urllib.parse.urlencode(params)
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Someone-s-Houston public-data preparation/1.0'})
            with urllib.request.urlopen(req, timeout=60) as response:
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError('FEMA response exceeds bounded request size')
            obj = json.loads(raw)
            if obj.get('error'):
                raise ValueError('FEMA query rejected: ' + json.dumps(obj['error']))
            return obj, len(raw)
        except (OSError, ValueError) as error:
            last = error
            if attempt < 2:
                time.sleep(1 + attempt)
    raise RuntimeError(f'FEMA request failed: {last}')


def query_ids(layer, bounds):
    params = dict(f='json', where='1=1', geometry=','.join(map(str, bounds)),
                  geometryType='esriGeometryEnvelope', inSR='4326',
                  spatialRel='esriSpatialRelIntersects', returnIdsOnly='true')
    data, _ = request(f'{BASE}/{layer}/query', params)
    ids = data.get('objectIds')
    if not isinstance(ids, list) or not ids or len(ids) > MAX_LAYER_FEATURES:
        raise ValueError(f'Unexpected FEMA layer {layer} ID set')
    if any(type(v) is not int or v <= 0 for v in ids) or len(set(ids)) != len(ids):
        raise ValueError('Invalid or duplicate FEMA object IDs')
    return sorted(ids)


def fetch_page(layer, wanted, target, resume=False, now=None):
    """Resume is explicit; matching IDs alone never establishes content freshness."""
    checked = now or datetime.now(timezone.utc)
    identity = digest([BASE, layer, FIELDS[layer], wanted])
    if resume and target.exists() and target.stat().st_size <= MAX_BYTES + 4096:
        try:
            envelope = json.loads(target.read_bytes())
            fetched = datetime.fromisoformat(envelope['fetched_at'])
            age = (checked - fetched).total_seconds()
            if (envelope.get('cache_version') == 1 and envelope.get('request_identity') == identity
                    and 0 <= age <= RESUME_MAX_AGE_SECONDS
                    and type(envelope.get('response_bytes')) is int
                    and 0 < envelope['response_bytes'] <= MAX_BYTES):
                return envelope['data'], envelope['response_bytes'], fetched.isoformat(), True
        except (ValueError, KeyError, TypeError):
            pass  # Legacy, corrupted or undated caches are fetched again.
    data, size = request(f'{BASE}/{layer}/query', dict(
        f='geojson', objectIds=','.join(map(str, wanted)), outFields=FIELDS[layer],
        returnGeometry='true', outSR='4326'))
    fetched_at = checked.isoformat()  # Request start is conservative for slow/retried responses.
    envelope = dict(cache_version=1, request_identity=identity, fetched_at=fetched_at,
                    response_bytes=size, data=data)
    pending = target.with_suffix('.json.tmp')
    pending.write_text(json.dumps(envelope, separators=(',', ':')), encoding='utf-8')
    pending.replace(target)
    return data, size, fetched_at, False


def fetch_layer(layer, bounds, cache, resume=False):
    metadata, _ = request(f'{BASE}/{layer}', {'f': 'json'})
    available = {field['name'] for field in metadata.get('fields', [])}
    if not set(FIELDS[layer].split(',')) <= available:
        raise ValueError(f'FEMA layer {layer} schema changed')
    ids = query_ids(layer, bounds)
    folder = cache / f'layer-{layer}-{digest([bounds, FIELDS[layer], ids])[:16]}'
    folder.mkdir(parents=True, exist_ok=True)
    batches = [ids[start:start + 100] for start in range(0, len(ids), 100)]

    def page(item):
        number, wanted = item
        target = folder / f'{number:04d}.json'
        data, size, fetched_at, reused = fetch_page(layer, wanted, target, resume=resume)
        features = data.get('features', [])
        got = [f.get('properties', {}).get('OBJECTID') for f in features]
        if data.get('exceededTransferLimit') or sorted(got) != wanted:
            raise ValueError(f'Incomplete FEMA layer {layer} batch {number}')
        if len({f['properties']['OBJECTID'] for f in features}) != len(features):
            raise ValueError('Duplicate FEMA feature')
        if size > MAX_BYTES:
            raise ValueError('Oversized cached FEMA response')
        return features, size, fetched_at, reused

    features, total_bytes, fetched_times, reused_count = [], 0, [], 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i, (batch, size, fetched_at, reused) in enumerate(pool.map(page, enumerate(batches))):
            features.extend(batch)
            total_bytes += size
            fetched_times.append(fetched_at)
            reused_count += int(reused)
            if total_bytes > MAX_LAYER_BYTES:
                raise ValueError('FEMA layer exceeds download limit')
            if i % 10 == 0:
                print(f'FEMA layer {layer}: {len(features)}/{len(ids)} features', flush=True)
    after = query_ids(layer, bounds)
    if after != ids:
        raise ValueError(f'FEMA layer {layer} changed during download')
    features.sort(key=lambda f: f['properties']['OBJECTID'])
    return features, dict(source_url=f'{BASE}/{layer}', expected_count=len(ids),
        retrieved_count=len(features), complete_id_set_before_after=True,
        source_sha256=digest(features), downloaded_bytes=total_bytes,
        source_checked_at=min(fetched_times), latest_batch_retrieved_at=max(fetched_times),
        resumed_batch_count=reused_count,
        source_data_last_edit_at=metadata.get('editingInfo', {}).get('dataLastEditDate'))


def polygon_parts(geom):
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [p for g in geom.geoms for p in polygon_parts(g)]
    return []


def prepare_geometry(feature, repairs):
    geo = shape(feature['geometry'])
    if geo.geom_type not in ('Polygon', 'MultiPolygon') or geo.is_empty:
        raise ValueError('Expected nonempty FEMA polygon')
    if not (-180 <= geo.bounds[0] <= geo.bounds[2] <= 180 and
            -90 <= geo.bounds[1] <= geo.bounds[3] <= 90):
        raise ValueError('Invalid WGS84 coordinates')
    geo = transform(PROJECT, geo)
    if not geo.is_valid:
        repaired = unary_union(polygon_parts(make_valid(geo)))
        delta = abs(repaired.area - geo.area)
        if repaired.is_empty or not repaired.is_valid or delta > max(1.0, geo.area * 0.00001):
            raise ValueError('FEMA topology repair would materially change area')
        repairs.append({'object_id': feature['properties']['OBJECTID'], 'area_change_m2': round(delta, 6)})
        geo = repaired
    return geo


def effective_date(value, today):
    if type(value) not in (int, float):
        return None
    try:
        dt = datetime.fromtimestamp(value / 1000, timezone.utc)
        return dt.date().isoformat() if 1900 <= dt.year <= today.year and dt.date() <= today.date() else None
    except (OverflowError, ValueError, OSError):
        return None


def classify(properties):
    zone = properties.get('FLD_ZONE')
    sub = properties.get('ZONE_SUBTY') or ''
    flag = properties.get('SFHA_TF')
    if zone in ('A', 'AE', 'AH', 'AO', 'AR', 'A99', 'V', 'VE') and flag == 'T':
        return 'sfha'
    if zone == 'X' and flag == 'F':
        if sub == '0.2 PCT ANNUAL CHANCE FLOOD HAZARD':
            return 'moderate'
        if sub in ('AREA OF MINIMAL FLOOD HAZARD', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE'):
            return 'other_mapped'
    return 'unknown'


def percentage(part, whole):
    return round(min(100.0, max(0.0, 100.0 * part / whole)), 4)


def complete_percentages(area, coverage, valid_panel_coverage, unknown_area, sfha, moderate, floodway):
    okay = (percentage(coverage, area) >= COVERAGE_THRESHOLD and
            percentage(valid_panel_coverage, area) >= COVERAGE_THRESHOLD and
            percentage(unknown_area, area) <= 100 - COVERAGE_THRESHOLD)
    return {
        'availability': 'reference_summary' if okay else 'insufficient_coverage',
        'sfha_area_pct': percentage(sfha, area) if okay else None,
        'annual_0_2_pct_area_pct': percentage(moderate, area) if okay else None,
        'floodway_area_pct': percentage(floodway, area) if okay else None,
    }


def aggregate(boundaries, layers, now):
    prepared, repairs = {}, {}
    for layer, features in layers.items():
        fixes = []
        prepared[layer] = [(f['properties'], prepare_geometry(f, fixes)) for f in features]
        repairs[str(layer)] = fixes
    indexes = {key: STRtree([g for _, g in values]) for key, values in prepared.items()}

    def relevant(layer, boundary):
        return [prepared[layer][int(i)] for i in indexes[layer].query(boundary, predicate='intersects')]

    def union_area(geometries, boundary):
        return unary_union(geometries).intersection(boundary).area if geometries else 0.0

    rows = []
    for feature in sorted(boundaries['features'], key=lambda f: f['properties']['neighborhood_id']):
        props = feature['properties']
        if props['neighborhood_id'] % 10 == 1:
            print(f'FEMA spatial validation: neighborhood {props["neighborhood_id"]}/88', flush=True)
        boundary = transform(PROJECT, shape(feature['geometry']))
        if not boundary.is_valid or boundary.area <= 0:
            raise ValueError('Canonical neighborhood geometry is invalid')
        zones = relevant(28, boundary)
        groups = {k: [g for p, g in zones if classify(p) == k] for k in ('sfha', 'moderate', 'other_mapped', 'unknown')}
        known = unary_union(groups['sfha'] + groups['moderate'] + groups['other_mapped'])
        mapped_area = known.intersection(boundary).area
        # Unknown geography takes precedence even if an overlapping known polygon exists.
        unknown_area = union_area(groups['unknown'], boundary)
        panels = relevant(3, boundary)
        dated_panels = [(p, g, effective_date(p.get('EFF_DATE'), now)) for p, g in panels]
        valid_panel_area = union_area([g for p, g, date in dated_panels if date], boundary)
        dates = sorted({date for p, g, date in dated_panels if date})
        lomrs = relevant(1, boundary)
        effective_lomrs = [(p, g) for p, g in lomrs if p.get('STATUS') == 'Effective']
        revision_dates = sorted({date for p, g in effective_lomrs if (date := effective_date(p.get('EFF_DATE'), now))})
        sfha_area = union_area(groups['sfha'], boundary)
        moderate_area = union_area(groups['moderate'], boundary)
        floodway_area = union_area([g for p, g in zones if 'FLOODWAY' in (p.get('ZONE_SUBTY') or '')], boundary)
        overlap = unary_union(groups['sfha']).intersection(unary_union(groups['moderate'])).intersection(boundary).area
        flags = []
        if overlap > max(1, boundary.area * 0.00001):
            flags.append('Conflicting SFHA and moderate-zone overlap exceeds topology tolerance; percentages withheld.')
        if floodway_area > sfha_area + max(1, boundary.area * 0.00001):
            flags.append('Mapped floodway is not contained in SFHA; percentages withheld.')
        facts = complete_percentages(boundary.area, mapped_area, valid_panel_area, unknown_area, sfha_area, moderate_area, floodway_area)
        available_area = union_area([g for _, g in relevant(0, boundary)], boundary)
        if percentage(available_area, boundary.area) < COVERAGE_THRESHOLD or flags:
            facts.update(availability='insufficient_coverage', sfha_area_pct=None, annual_0_2_pct_area_pct=None, floodway_area_pct=None)
        if facts['availability'] != 'reference_summary' and not flags:
            flags.append('Incomplete or unclassified coverage; exposure percentages withheld.')
        rows.append(dict(neighborhood_id=props['neighborhood_id'], name=props['name'],
            boundary_version=props['boundary_version'], **facts,
            neighborhood_area_m2=round(boundary.area, 2),
            mapped_zone_coverage_pct=percentage(mapped_area, boundary.area),
            nfhl_availability_coverage_pct=percentage(available_area, boundary.area),
            effective_panel_coverage_pct=percentage(valid_panel_area, boundary.area),
            unclassified_zone_area_pct=percentage(unknown_area, boundary.area),
            zone_category_overlap_pct=percentage(overlap, boundary.area),
            source_polygon_count=len(zones), effective_panel_count=sum(bool(date) for _, _, date in dated_panels),
            missing_or_future_panel_date_count=sum(not date for _, _, date in dated_panels),
            panel_effective_date_min=dates[0] if dates else None,
            panel_effective_date_max=dates[-1] if dates else None,
            lomr_count=len(effective_lomrs), superseded_lomr_count=sum(p.get('STATUS') == 'Superseded' for p, g in lomrs),
            latest_lomr_effective_date=revision_dates[-1] if revision_dates else None,
            reduced_risk_due_to_levee_area_pct=percentage(union_area([g for p, g in zones if p.get('ZONE_SUBTY') == 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE'], boundary), boundary.area),
            flags=flags))
    return rows, repairs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path, required=True)
    parser.add_argument('--resume', action='store_true', help='Reuse explicitly timestamped responses up to one hour old; preserve their original freshness dates.')
    args = parser.parse_args()
    boundaries = json.loads((BACKEND / 'data/super-neighborhood-boundaries.geojson').read_text())
    ids = [f['properties']['neighborhood_id'] for f in boundaries['features']]
    if sorted(ids) != list(range(1, 89)):
        raise ValueError('Expected exactly 88 canonical neighborhood IDs')
    versions = {f['properties']['boundary_version'] for f in boundaries['features']}
    if len(versions) != 1:
        raise ValueError('Mixed neighborhood boundary versions')
    bounds_list = [shape(f['geometry']).bounds for f in boundaries['features']]
    bounds = [min(b[0] for b in bounds_list), min(b[1] for b in bounds_list), max(b[2] for b in bounds_list), max(b[3] for b in bounds_list)]
    now = datetime.now(timezone.utc)
    layers, manifests = {}, {}
    for layer in (0, 3, 1, 28):
        layers[layer], manifests[str(layer)] = fetch_layer(layer, bounds, args.cache_dir, resume=args.resume)
    rows, repairs = aggregate(boundaries, layers, now)
    output = dict(schema_version=1, source_id='fema_nfhl_neighborhood_exposure',
        source_url=f'{BASE}/28', source_checked_at=min(m['source_checked_at'] for m in manifests.values()),
        prepared_at=datetime.now(timezone.utc).isoformat(),
        freshness_note='source_checked_at is the oldest actual content-request start, including resumed responses; prepared_at is validation completion, not renewed source freshness.',
        source_period='Current effective NFHL snapshot; per-neighborhood panel and LOMR dates retained.',
        boundary_version=next(iter(versions)), bbox_wgs84=bounds, source_layers=manifests,
        coordinate_area_method='EPSG:5070 equal-area projection; full source geometry, union before intersection; total neighborhood area including water.',
        coverage_threshold_pct=COVERAGE_THRESHOLD, geometry_repairs=repairs,
        source_version=digest([{key: value['source_sha256'] for key, value in manifests.items()}, next(iter(versions))])[:24],
        definitions={
            'sfha_area_pct': 'Percent of neighborhood area mapped as special flood hazard area (1% annual-chance floodplain); includes floodway.',
            'annual_0_2_pct_area_pct': 'Percent mapped specifically as 0.2% annual-chance zone X, excluding SFHA. Not a cumulative 0.2% flood envelope.',
            'floodway_area_pct': 'Percent in a mapped floodway; subset of SFHA, so do not add it to SFHA.',
        }, limitations=[
            'Mapped area share is not a probability that a home or resident will flood and is not a safety score.',
            'Neighborhood total-area denominator includes water and nonresidential land; not dwelling-weighted.',
            'Panel dates describe effective map editions, not the age of all underlying studies; newer LOMRs may modify older panels.',
            'Effective NFHL only; preliminary future maps, property-specific LOMAs, drainage/pluvial flooding and future climate are not evaluated.',
            'Mapped minimal-hazard or outside-SFHA areas can still flood. No flood-hazard record is not interpreted as zero exposure.',
            'Coverage below 99.99%, unknown classification or missing effective-date coverage suppresses exposure percentages.',
        ], records=rows)
    destination = BACKEND / 'data/neighborhood-flood-exposure.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(output, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(destination)
    print(json.dumps({'output': str(destination), 'rows': len(rows), 'availability': dict(Counter(r['availability'] for r in rows)), 'bytes': destination.stat().st_size, 'geometry_repairs': {k: len(v) for k, v in repairs.items()}}))


if __name__ == '__main__':
    main()
