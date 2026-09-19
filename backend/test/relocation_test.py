import importlib.util
import io
import json
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from shapely.geometry import Polygon

spec = importlib.util.spec_from_file_location("prepare_relocation", Path(__file__).parents[1] / "tools/prepare-relocation-context.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RelocationTests(unittest.TestCase):
    def test_calendar_exceptions_override_weekday_flags(self):
        calendar = [{"service_id":"work", "monday":"1", "start_date":"20260901", "end_date":"20260930"}]
        exceptions = [{"service_id":"work", "date":"20260921", "exception_type":"2"},
                      {"service_id":"holiday", "date":"20260921", "exception_type":"1"}]
        self.assertEqual(module.active_services(calendar, exceptions, date(2026,9,21)), {"holiday"})
        with self.assertRaises(ValueError):
            module.active_services(calendar, exceptions+exceptions, date(2026,9,21))

    def fixture(self, orphan=False):
        stream = io.BytesIO()
        with ZipFile(stream, "w") as archive:
            files = {
                "feed_info.txt":"feed_start_date,feed_end_date,feed_version\n20260901,20260930,test\n",
                "agency.txt":"agency_timezone\nAmerica/Chicago\n",
                "calendar.txt":"service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,1,1,20260901,20260930\n",
                "routes.txt":"route_id,route_short_name,route_long_name,route_type\nr,1,Test route,3\n",
                "stops.txt":"stop_id,stop_name,stop_lat,stop_lon,location_type\na,Inside,29.75,-95.35,0\nb,Outside,29.95,-95.35,0\n",
                "trips.txt":"trip_id,route_id,service_id\nt,r,s\n",
                "stop_times.txt": "trip_id,stop_id,pickup_type\nt,a,0\nt,b,1\n" + ("t,missing,0\n" if orphan else ""),
            }
            for name, text in files.items():
                archive.writestr(name, text)
        boundary = ({"boundary_version":"test"}, [{"properties":{"neighborhood_id":1}}],
                    [Polygon([(-95.4,29.7),(-95.3,29.7),(-95.3,29.8),(-95.4,29.8)])],
                    {n:{"centroid_lon":-95.35,"centroid_lat":29.75} for n in range(1,89)})
        return stream.getvalue(), boundary

    def test_only_active_ordinary_pickup_stops_are_counted(self):
        raw, boundary = self.fixture()
        result=module.transit_snapshot(raw,"2026-09-19T00:00:00Z",date(2026,9,19),boundary)
        self.assertEqual(len(result["rows"]),88)
        self.assertEqual(result["rows"][0]["facts"]["stop_count"],1)
        self.assertEqual(result["rows"][1]["facts"]["stop_count"],0)
        self.assertFalse(result["rows"][1]["facts"]["nearest_stops"][0]["inside_neighborhood"])
        self.assertEqual(result["rows"][0]["facts"]["nearest_stops"][0]["straight_line_meters"],0)

    def test_orphan_stop_and_expired_feed_are_rejected(self):
        raw,boundary=self.fixture(orphan=True)
        with self.assertRaisesRegex(ValueError,"Orphan"):
            module.transit_snapshot(raw,"2026-09-19T00:00:00Z",date(2026,9,19),boundary)
        raw,boundary=self.fixture()
        with self.assertRaisesRegex(ValueError,"validity"):
            module.transit_snapshot(raw,"2026-09-19T00:00:00Z",date(2026,9,29),boundary)

    def test_crime_import_preserves_null_and_rejects_duplicate_ids(self):
        rows=[{"attributes":{"SNBR_ID":n,"SNBR":str(n), **{f:None if n==7 else n for f in module.OFFENSES.values()}}} for n in range(1,89)]
        def fetch(url,limit):
            if "returnCountOnly" in url: return b'{"count":88}'
            if "/query?" in url: return json.dumps({"features":rows}).encode()
            return json.dumps({"name":"test", "fields":[{"name":f} for f in ["SNBR_ID","SNBR",*module.OFFENSES.values()]]}).encode()
        with patch.object(module,"fetch",fetch):
            result=module.crime_snapshot("boundary")
            self.assertIsNone(result["rows"][6]["facts"]["counts"]["robbery"])
            rows[1]["attributes"]["SNBR_ID"]=1
            with self.assertRaisesRegex(ValueError,"IDs"):
                module.crime_snapshot("boundary")

    def test_committed_summaries_are_complete_and_small(self):
        path=Path(__file__).parents[1]/"data/neighborhood-relocation-context.json"
        data=json.loads(path.read_text(encoding="utf-8"))
        self.assertLess(path.stat().st_size,250000)
        self.assertEqual({s["source"]["source_id"] for s in data["snapshots"]},{"metro_gtfs","hpd_crime_2024"})
        for snapshot in data["snapshots"]:
            self.assertEqual(len(snapshot["rows"]),88)
            self.assertEqual({r["neighborhood_id"] for r in snapshot["rows"]},set(range(1,89)))


if __name__=="__main__": unittest.main()
