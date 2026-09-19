"""Prepare six source-backed conservative ranking inputs; preserve missing observations.

Uses the existing FEMA bounded downloader, canonical boundaries, and City's 2024
rent-distribution PDF. Never writes to Supabase. No regional averages/imputation.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import sys
from datetime import datetime, timezone, timedelta
from urllib.request import Request, urlopen
import pdfplumber
from shapely.geometry import shape
from shapely.ops import transform, unary_union

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / 'scripts'))
import prepare_flood as flood

RENT_URL = 'https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf'

def rent_bounds(raw):
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        if len(pdf.pages) != 4:
            raise ValueError('Rent PDF changed')
        text = pdf.pages[0].extract_text()
    if '2020-2024 ACS' not in text:
        raise ValueError('Wrong rent edition')
    lines = [line for line in text.splitlines() if 'HIDDEN VALLEY' in line]
    if len(lines) != 1 or lines[0].split() != ['7', 'HIDDEN', 'VALLEY', '110', '0', '0', '0', '0', '110', '0', '0']:
        raise ValueError('Hidden Valley rent distribution changed; review bins')
    return 1500, 1999, lines[0]

def bounded_flood(boundary, layers):
    repairs = []
    zones = [(f['properties'], flood.prepare_geometry(f, repairs)) for f in layers[28]]
    union = lambda gs: unary_union(gs).intersection(boundary)
    sfha = union([g for p,g in zones if flood.classify(p) == 'sfha'])
    other = union([g for p,g in zones if flood.classify(p) in ('moderate','other_mapped')])
    unknown = union([g for p,g in zones if flood.classify(p) == 'unknown'])
    now = datetime.now(timezone.utc)
    panels = union([flood.prepare_geometry(f, repairs) for f in layers[3] if flood.effective_date(f['properties'].get('EFF_DATE'), now)])
    available = union([flood.prepare_geometry(f, repairs) for f in layers[0]])
    # Any unclassified, uncovered, undated or contradictory geography is uncertain.
    uncertain = unary_union([boundary.difference(unary_union([sfha, other])), unknown,
        boundary.difference(panels), boundary.difference(available), sfha.intersection(other)]).intersection(boundary)
    lower = sfha.difference(uncertain).area / boundary.area * 100
    upper = unary_union([sfha, uncertain]).area / boundary.area * 100
    # Directed rounding preserves an enclosing interval.
    lower, upper = math.floor(lower * 10000) / 10000, min(100, math.ceil(upper * 10000) / 10000)
    width = upper - lower
    if not 0 <= lower <= upper <= 100 or width > 5:
        raise ValueError(f'Uncertainty exceeds reviewed five-percentage-point bound: {width}')
    return lower, upper, {'uncertain_area_pct': uncertain.area/boundary.area*100,
        'source_polygon_count':len(zones), 'geometry_repairs':repairs,
        'method':'EPSG:5070 full precision; union before clipping; unknown/uncovered/conflicting area included in upper bound, excluded from lower bound. Bounds cover map classification only, not statistical or future flood uncertainty.'}

def main():
    checked = datetime.now(timezone.utc)
    cache = BACKEND / 'data/raw/expanded/gap-inputs'
    cache.mkdir(parents=True, exist_ok=True)
    boundary_path = BACKEND / 'data/super-neighborhood-boundaries.geojson'
    raw_boundaries = boundary_path.read_bytes()
    manifest = json.loads((BACKEND/'data/super-neighborhood-boundaries.manifest.json').read_bytes())
    # Reuse the reviewed immutable boundary edition, with a byte receipt in each row.
    boundaries = json.loads(raw_boundaries)
    if sorted(f['properties']['neighborhood_id'] for f in boundaries['features']) != list(range(1,89)):
        raise ValueError('Boundary cohort incomplete')
    versions = {f['properties']['boundary_version'] for f in boundaries['features']}
    if len(versions) != 1: raise ValueError('Mixed boundary versions')
    boundary_version = next(iter(versions))
    boundary_sha = hashlib.sha256(raw_boundaries).hexdigest()
    if boundary_sha not in json.dumps(manifest): raise ValueError('Boundary receipt mismatch')
    rows = []
    def row(id, category, metric, lower, upper, source_url, period, stamp, receipt, audit):
        return dict(neighborhood_id=id, category_id=category, metric=metric, lower_bound=lower,
            upper_bound=upper, ranking_value=upper, method='conservative_upper_bound',
            source_url=source_url, source_period=period, source_checked_at=stamp,
            refresh_due_at=(datetime.fromisoformat(stamp)+timedelta(days=31)).isoformat(),
            source_sha256=receipt, boundary_version=boundary_version,
            audit={**audit,'boundary_sha256':boundary_sha},
            limitation='Derived ranking input, not a published point estimate. Original missing observation remains null. Upper bound is used because lower cost/exposure is favored; this is a conservative scenario, not a best estimate.')
    with urlopen(Request(RENT_URL,headers={'User-Agent':'Houston relocation public data/1.0'}), timeout=30) as response:
        raw = response.read(2_000_001)
    if len(raw)>2_000_000: raise ValueError('Oversized rent PDF')
    (cache/'rent.pdf').write_bytes(raw)
    low, high, line = rent_bounds(raw)
    rows.append(row(7,'afford','rent_usd',low,high,RENT_URL,'ACS 2020–2024; published January 2026',checked.isoformat(),hashlib.sha256(raw).hexdigest(),
        {'published_row':line,'estimated_rent_paying_units':110,'median_band_usd':[low,high],
         'note':'110 is an estimated housing-unit count, not survey sample size. Exact median suppressed by City for insufficient sample observations. Band is not a confidence interval or current asking rent.'}))
    for id in [17,25,41,43,80]:
        feature = next(f for f in boundaries['features'] if f['properties']['neighborhood_id']==id)
        geo = shape(feature['geometry'])
        projected = transform(flood.PROJECT,geo)
        if not projected.is_valid or projected.area<=0: raise ValueError('Invalid canonical boundary')
        layers, manifests = {}, {}
        for layer in [0,3,28]:
            layers[layer], manifests[str(layer)] = flood.fetch_layer(layer,list(geo.bounds),cache / str(id),resume=True)
        low,high,audit = bounded_flood(projected,layers)
        stamp=min(m['source_checked_at'] for m in manifests.values())
        rows.append(row(id,'flood','sfha_area_pct',low,high,flood.BASE+'/28','Current effective FEMA NFHL; dated panel coverage checked',stamp,flood.digest(manifests),{**audit,'source_layers':manifests}))
        print(json.dumps({'id':id,'lower':low,'upper':high}),flush=True)
    output=BACKEND/'data/neighborhood-gap-inputs.json'
    output.write_text(json.dumps({'schema_version':1,'rows':rows},indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({'rows':len(rows),'output':str(output)}))

if __name__=='__main__': main()
