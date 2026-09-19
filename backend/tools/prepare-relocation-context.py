"""Bounded METRO/City imports; prepares public context, never rankings or rates."""
import argparse
import csv
import hashlib
import io
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from zipfile import ZipFile

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

BACKEND = Path(__file__).resolve().parents[1]
GTFS = "https://metro.resourcespace.com/pages/download.php?ref=4835&ext=zip"
CRIME = "https://services.arcgis.com/NummVBqZSIJKUeVR/ArcGIS/rest/services/HPD_Crime_Summary/FeatureServer/0"
OFFENSES = {
    "aggravated_assault": "HPD_NIBRS_AI_13A_CNT_2024",
    "robbery": "HPD_NIBRS_AP_120_CNT_2024",
    "burglary": "HPD_NIBRS_AP_220_CNT_2024",
    "motor_vehicle_theft": "HPD_NIBRS_AP_240_CNT_2024",
    "theft_from_motor_vehicle": "HPD_NIBRS_AP_23F_CNT_2024",
}


def fetch(url, limit):
    with urlopen(Request(url, headers={"User-Agent": "SomeonesHouston/1.0 public-data-import"}), timeout=45) as response:
        final = urlparse(response.url)
        if final.scheme != "https" or final.hostname != urlparse(url).hostname:
            raise ValueError("Unexpected download redirect")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Source exceeds download bound")
    return data


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def json_bytes(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def rows(archive, name, limit):
    with archive.open(name) as source:
        for index, row in enumerate(csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig", newline=""))):
            if index >= limit:
                raise ValueError(f"{name} exceeds row bound")
            yield row


def unique(rows_in, key):
    result = {}
    for row in rows_in:
        ident = row.get(key)
        if not ident or ident in result:
            raise ValueError(f"Missing/duplicate {key}")
        result[ident] = row
    if not result:
        raise ValueError(f"Empty {key} inventory")
    return result


def active_services(calendar, exceptions, service_date):
    weekday = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][service_date.weekday()]
    text = service_date.strftime("%Y%m%d")
    active = set()
    for row in calendar:
        if row[weekday] not in ("0", "1"):
            raise ValueError("Invalid GTFS weekday flag")
        if row["start_date"] <= text <= row["end_date"] and row[weekday] == "1":
            active.add(row["service_id"])
    seen = set()
    for row in exceptions:
        pair = (row["service_id"], row["date"])
        if pair in seen or row["exception_type"] not in ("1", "2"):
            raise ValueError("Invalid/duplicate calendar exception")
        seen.add(pair)
        if row["date"] == text:
            if row["exception_type"] == "1":
                active.add(row["service_id"])
            else:
                active.discard(row["service_id"])
    return active


def distance_meters(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(math.radians(lon2-lon1)/2)**2
    return round(6371008.8 * 2 * math.asin(min(1, math.sqrt(a))))


def load_boundaries():
    manifest = json.loads((BACKEND / "data/super-neighborhood-boundaries.manifest.json").read_text())
    raw = (BACKEND / "data/super-neighborhood-boundaries.geojson").read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest["sha256"]:
        raise ValueError("Boundary bytes do not match reviewed manifest")
    features = json.loads(raw)["features"]
    if len(features) != 88 or {f["properties"]["neighborhood_id"] for f in features} != set(range(1, 89)):
        raise ValueError("Incomplete boundary cohort")
    geometries = [shape(f["geometry"]) for f in features]
    if any(not g.is_valid or g.is_empty for g in geometries):
        raise ValueError("Invalid boundary geometry")
    profiles = json.loads((BACKEND / "data/super-neighborhoods.json").read_text())
    # Prepared profile file is an envelope, not raw HTTP JSON.
    if isinstance(profiles, dict):
        profiles = profiles["neighborhoods"]
    return manifest, features, geometries, {p["neighborhood_id"]: p for p in profiles}


def transit_snapshot(raw, checked_at, service_start, boundary):
    manifest, features, geometries, profiles = boundary
    archive = ZipFile(io.BytesIO(raw))
    if len(archive.infolist()) > 40 or sum(f.file_size for f in archive.infolist()) > 150_000_000:
        raise ValueError("Oversized GTFS archive")
    if len(set(archive.namelist())) != len(archive.namelist()):
        raise ValueError("Duplicate ZIP filenames")
    if "frequencies.txt" in archive.namelist() and list(rows(archive, "frequencies.txt", 10000)):
        raise ValueError("Frequency-based service requires explicit support")
    feed = list(rows(archive, "feed_info.txt", 1))[0]
    agency = list(rows(archive, "agency.txt", 10))
    if not agency or any(a["agency_timezone"] != "America/Chicago" for a in agency):
        raise ValueError("Unexpected agency timezone")
    service_dates = [service_start + timedelta(days=d) for d in range(7)]
    feed_start = datetime.strptime(feed["feed_start_date"], "%Y%m%d").date()
    feed_end = datetime.strptime(feed["feed_end_date"], "%Y%m%d").date()
    if service_dates[0] < feed_start or service_dates[-1] > feed_end:
        raise ValueError("Requested service window outside feed validity")
    calendar = list(rows(archive, "calendar.txt", 1000))
    if len({r["service_id"] for r in calendar}) != len(calendar):
        raise ValueError("Duplicate calendar service")
    exceptions = list(rows(archive, "calendar_dates.txt", 10000)) if "calendar_dates.txt" in archive.namelist() else []
    services = set().union(*(active_services(calendar, exceptions, day) for day in service_dates))
    known_services = {r["service_id"] for r in calendar + exceptions}
    routes = unique(rows(archive, "routes.txt", 1000), "route_id")
    stops = unique(rows(archive, "stops.txt", 20000), "stop_id")
    trips = unique(rows(archive, "trips.txt", 100000), "trip_id")
    for trip in trips.values():
        if trip["route_id"] not in routes or trip["service_id"] not in known_services:
            raise ValueError("Orphan trip route/service")
    stop_routes = defaultdict(set)
    stop_time_rows = 0
    for row in rows(archive, "stop_times.txt", 3_000_000):
        stop_time_rows += 1
        if row["trip_id"] not in trips or row["stop_id"] not in stops:
            raise ValueError("Orphan stop time")
        trip = trips[row["trip_id"]]
        if row.get("pickup_type", "0") not in ("", "0", "1", "2", "3"):
            raise ValueError("Unknown pickup type")
        # Only ordinary scheduled pickup: no telephone/driver arrangements.
        if trip["service_id"] in services and row.get("pickup_type", "0") in ("", "0"):
            stop_routes[row["stop_id"]].add(trip["route_id"])
    if not stop_routes:
        raise ValueError("No ordinary pickup service in the requested window")
    tree = STRtree(geometries)
    active_stops = []
    members = defaultdict(list)
    for ident, route_ids in sorted(stop_routes.items()):
        stop = stops[ident]
        if stop.get("location_type", "0") not in ("", "0"):
            continue
        lat, lon = float(stop["stop_lat"]), float(stop["stop_lon"])
        if not (28 <= lat <= 31.5 and -97.5 <= lon <= -94):
            raise ValueError("Invalid Houston-region stop coordinates")
        if not stop["stop_name"] or len(stop["stop_name"]) > 300:
            raise ValueError("Invalid stop name")
        point = Point(lon, lat)
        ids = sorted(features[int(i)]["properties"]["neighborhood_id"] for i in tree.query(point) if geometries[int(i)].covers(point))
        item = {"stop_id": ident, "name": stop["stop_name"], "latitude": lat, "longitude": lon,
                "route_ids": sorted(route_ids), "neighborhood_ids": ids}
        active_stops.append(item)
        for nid in ids:
            members[nid].append(item)
    output = []
    for nid in range(1, 89):
        local = members[nid]
        route_ids = sorted(set().union(*(set(s["route_ids"]) for s in local)))
        profile = profiles[nid]
        nearest = sorted(({**s, "straight_line_meters": distance_meters(profile["centroid_lon"], profile["centroid_lat"], s["longitude"], s["latitude"]),
                           "inside_neighborhood": nid in s["neighborhood_ids"]} for s in active_stops), key=lambda s: (s["straight_line_meters"], s["stop_id"]))[:5]
        output.append({"neighborhood_id": nid, "facts": {
            "stop_count": len(local), "active_route_count": len(route_ids),
            "rail_stop_count": sum(any(int(routes[r]["route_type"]) in (0, 1, 2, 12) for r in s["route_ids"]) for s in local),
            "service_dates": [d.isoformat() for d in service_dates],
            "routes": [{"route_id": r, "short_name": routes[r]["route_short_name"], "long_name": routes[r]["route_long_name"], "route_type": int(routes[r]["route_type"])} for r in route_ids],
            "nearest_stops": nearest,
        }})
    expiry = datetime.combine(service_dates[-1] + timedelta(days=1), datetime.min.time(), timezone.utc).isoformat().replace("+00:00", "Z")
    return envelope("metro_gtfs", "transit", GTFS, raw, checked_at, expiry, manifest["boundary_version"],
        f"Scheduled pickup service on {service_dates[0]} through {service_dates[-1]} (America/Chicago); feed {feed['feed_version']}",
        "Route and arrival data provided by permission of METRO",
        ["Static schedule, not real-time arrivals, service reliability or a workplace route.",
         "Counts are stop/platform records and routes offering ordinary pickup on at least one selected day; not departures or frequency.",
         "Nearest stops use straight-line distance from the neighborhood reference point, may lie outside it, and do not establish a walkable route.",
         "Zero inside-boundary stops does not mean no nearby transit. Telephone/driver-arranged pickup and frequency-based service are not included."],
        {"feed_start_date": str(feed_start), "feed_end_date": str(feed_end), "feed_version": feed["feed_version"],
         "stops_in_feed": len(stops), "active_stops_in_region": len(active_stops), "routes_in_feed": len(routes), "stop_time_rows_checked": stop_time_rows}, output)


def envelope(source_id, kind, url, raw, checked, expiry, boundary_version, period, attribution, limitations, audit, records):
    sha = hashlib.sha256(raw).hexdigest()
    version = hashlib.sha256(json_bytes({"raw": sha, "rows": records, "boundary": boundary_version})).hexdigest()[:16]
    return {"source": {"source_id": source_id, "kind": kind, "source_url": url,
        "source_sha256": sha, "source_checked_at": checked, "refresh_due_at": expiry,
        "boundary_version": boundary_version, "data_version": f"relocation-{version}",
        "source_period": period, "attribution": attribution, "limitations": limitations, "audit": audit}, "rows": records}


def crime_snapshot(boundary_version):
    fields = ["SNBR_ID", "SNBR"] + list(OFFENSES.values())
    metadata = json.loads(fetch(CRIME + "?f=json", 500_000))
    if not set(fields) <= {f["name"] for f in metadata["fields"]}:
        raise ValueError("Crime source schema changed")
    count_url = CRIME + "/query?" + urlencode({"where": "1=1", "returnCountOnly": "true", "f": "json"})
    if json.loads(fetch(count_url, 10000)).get("count") != 88:
        raise ValueError("Crime source count changed")
    raw = fetch(CRIME + "/query?" + urlencode({"where": "1=1", "outFields": ",".join(fields), "returnGeometry": "false", "orderByFields": "SNBR_ID", "f": "json"}), 500_000)
    body = json.loads(raw)
    if body.get("exceededTransferLimit") or len(body.get("features", [])) != 88:
        raise ValueError("Incomplete crime response")
    records = []
    for feature in body["features"]:
        attrs = feature["attributes"]
        nid = attrs["SNBR_ID"]
        if type(nid) is not int:
            raise ValueError("Non-integer City neighborhood ID")
        counts = {name: attrs[field] for name, field in OFFENSES.items()}
        if any(value is not None and (type(value) is not int or value < 0) for value in counts.values()):
            raise ValueError("Invalid crime count")
        records.append({"neighborhood_id": nid, "facts": {"year": 2024, "source_neighborhood_name": attrs["SNBR"], "counts": counts}})
    if {r["neighborhood_id"] for r in records} != set(range(1, 89)) or json.loads(fetch(count_url, 10000)).get("count") != 88:
        raise ValueError("Crime IDs incomplete or source changed")
    checked = utc_now()
    expiry = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat().replace("+00:00", "Z")
    return envelope("hpd_crime_2024", "reported_crime", CRIME, raw, checked, expiry, boundary_version,
        "Calendar year 2024; historical City-prepared summary. Newer HPD raw records are not included.",
        "Houston Police Department (HPD), Houston Information Technology Services (HITS)",
        ["Selected publisher-reported offense counts, not unique incidents, victims, population rates or a safety tier.",
         "Historical context only; not 2025/2026 conditions or a prediction. Counts do not enter the weighted model.",
         "Linked using the City's SNBR_ID. The crime publisher's boundary vintage/coordinate exclusions are not established.",
         "Do not rank neighborhoods by raw counts; visitor populations, reporting practices and coverage differ.",
         "Only the five named offense fields are included; no all-crime total, Group B arrests or justifiable-homicide total is inferred."],
        {"publisher_layer": metadata["name"], "field_mapping": OFFENSES, "rows_checked": 88}, sorted(records, key=lambda r: r["neighborhood_id"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-start-date", type=date.fromisoformat, required=True, help="First GTFS local calendar date, seven-day window")
    args = parser.parse_args()
    if abs((args.service_start_date - datetime.now(timezone.utc).date()).days) > 1:
        raise ValueError("Prepare a current service window; historical/far-future windows require review")
    boundary = load_boundaries()
    raw = fetch(GTFS, 25_000_000)
    checked = utc_now()
    snapshots = [transit_snapshot(raw, checked, args.service_start_date, boundary), crime_snapshot(boundary[0]["boundary_version"])]
    result = {"schema_version": 1, "prepared_at": utc_now(), "snapshots": snapshots}
    target = BACKEND / "data/neighborhood-relocation-context.json"
    target.write_bytes(json_bytes(result) + b"\n")
    print(json.dumps({"output": str(target), "bytes": target.stat().st_size, "sources": [{"id": s["source"]["source_id"], "rows": len(s["rows"]), "audit": s["source"]["audit"]} for s in snapshots]}))


if __name__ == "__main__":
    main()
