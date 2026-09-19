import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare_flood', Path(__file__).resolve().parents[1] / 'scripts/prepare_flood.py')
flood = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flood)


class FloodPreparationTests(unittest.TestCase):
    def test_default_fetch_ignores_recent_cache_when_contents_change_with_same_ids(self):
        now = datetime(2026, 9, 19, tzinfo=timezone.utc)
        old = {'features': [{'properties': {'OBJECTID': 1, 'FLD_ZONE': 'AE'}}]}
        new = {'features': [{'properties': {'OBJECTID': 1, 'FLD_ZONE': 'X'}}]}
        with TemporaryDirectory() as directory:
            target = Path(directory) / 'page.json'
            with patch.object(flood, 'request', side_effect=[(old, 100), (new, 100)]) as request:
                flood.fetch_page(28, [1], target, now=now)
                data, size, checked, reused = flood.fetch_page(28, [1], target, now=now + timedelta(minutes=1))
            self.assertEqual(request.call_count, 2)
            self.assertEqual(data, new)
            self.assertFalse(reused)
            self.assertEqual(checked, (now + timedelta(minutes=1)).isoformat())

    def test_explicit_resume_preserves_content_timestamp_and_expires_after_one_hour(self):
        now = datetime(2026, 9, 19, tzinfo=timezone.utc)
        old = {'features': [{'properties': {'OBJECTID': 1}}]}
        with TemporaryDirectory() as directory:
            target = Path(directory) / 'page.json'
            with patch.object(flood, 'request', return_value=(old, 100)) as request:
                flood.fetch_page(28, [1], target, now=now)
                _, _, checked, reused = flood.fetch_page(28, [1], target, resume=True, now=now + timedelta(minutes=30))
                self.assertTrue(reused)
                self.assertEqual(checked, now.isoformat())
                self.assertEqual(request.call_count, 1)
                _, _, checked, reused = flood.fetch_page(28, [1], target, resume=True, now=now + timedelta(hours=2))
                self.assertFalse(reused)
                self.assertEqual(request.call_count, 2)
                self.assertEqual(checked, (now + timedelta(hours=2)).isoformat())

    def test_resume_does_not_trust_recent_mtime_of_undated_legacy_cache(self):
        now = datetime(2026, 9, 19, tzinfo=timezone.utc)
        with TemporaryDirectory() as directory:
            target = Path(directory) / 'page.json'
            target.write_text('{"features": []}')
            with patch.object(flood, 'request', return_value=({'features': []}, 100)) as request:
                _, _, checked, reused = flood.fetch_page(28, [1], target, resume=True, now=now)
            self.assertEqual(request.call_count, 1)
            self.assertFalse(reused)
            self.assertEqual(checked, now.isoformat())

    def fixture(self, include_availability=True):
        polygon = {'type': 'Polygon', 'coordinates': [[[-95.4, 29.7], [-95.39, 29.7], [-95.39, 29.71], [-95.4, 29.71], [-95.4, 29.7]]]}
        def feature(properties):
            return {'type': 'Feature', 'properties': properties, 'geometry': polygon}
        boundaries = {'features': [feature({'neighborhood_id': 1, 'name': 'Test', 'boundary_version': 'test'})]}
        layers = {
            0: [feature({'OBJECTID': 1})] if include_availability else [],
            1: [],
            3: [feature({'OBJECTID': 1, 'EFF_DATE': 1182124800000})],
            28: [feature({'OBJECTID': i, 'FLD_ZONE': 'AE', 'SFHA_TF': 'T', 'ZONE_SUBTY': 'FLOODWAY'}) for i in (1, 2)],
        }
        return boundaries, layers

    def test_spatial_union_avoids_double_counting_and_preserves_floodway_subset(self):
        boundaries, layers = self.fixture()
        rows, repairs = flood.aggregate(boundaries, layers, datetime(2026, 9, 19, tzinfo=timezone.utc))
        self.assertEqual(rows[0]['sfha_area_pct'], 100)
        self.assertEqual(rows[0]['floodway_area_pct'], 100)
        self.assertEqual(rows[0]['annual_0_2_pct_area_pct'], 0)
        self.assertEqual(rows[0]['panel_effective_date_min'], '2007-06-18')

    def test_spatial_availability_gap_suppresses_metrics(self):
        boundaries, layers = self.fixture(False)
        rows, repairs = flood.aggregate(boundaries, layers, datetime(2026, 9, 19, tzinfo=timezone.utc))
        self.assertEqual(rows[0]['availability'], 'insufficient_coverage')
        self.assertIsNone(rows[0]['sfha_area_pct'])

    def test_conflicting_spatial_categories_are_flagged_and_withheld(self):
        boundaries, layers = self.fixture()
        layers[28][1]['properties'].update(FLD_ZONE='X', SFHA_TF='F', ZONE_SUBTY='0.2 PCT ANNUAL CHANCE FLOOD HAZARD')
        rows, repairs = flood.aggregate(boundaries, layers, datetime(2026, 9, 19, tzinfo=timezone.utc))
        self.assertIsNone(rows[0]['sfha_area_pct'])
        self.assertEqual(rows[0]['zone_category_overlap_pct'], 100)
        self.assertIn('Conflicting', rows[0]['flags'][0])

    def test_superseded_revision_cannot_set_latest_effective_revision(self):
        boundaries, layers = self.fixture()
        layers[1] = [{'geometry': boundaries['features'][0]['geometry'], 'properties': {
            'OBJECTID': 1, 'STATUS': 'Superseded', 'EFF_DATE': 1182124800000}}]
        rows, repairs = flood.aggregate(boundaries, layers, datetime(2026, 9, 19, tzinfo=timezone.utc))
        self.assertEqual(rows[0]['lomr_count'], 0)
        self.assertEqual(rows[0]['superseded_lomr_count'], 1)
        self.assertIsNone(rows[0]['latest_lomr_effective_date'])

    def test_classification_is_explicit_and_unknown_is_not_zero(self):
        self.assertEqual(flood.classify({'FLD_ZONE': 'AE', 'SFHA_TF': 'T'}), 'sfha')
        self.assertEqual(flood.classify({'FLD_ZONE': 'X', 'SFHA_TF': 'F', 'ZONE_SUBTY': '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'}), 'moderate')
        self.assertEqual(flood.classify({'FLD_ZONE': 'D', 'SFHA_TF': 'F'}), 'unknown')
        self.assertEqual(flood.classify({'FLD_ZONE': 'X', 'SFHA_TF': 'F'}), 'unknown')

    def test_missing_coverage_withholds_all_three_exposure_metrics(self):
        result = flood.complete_percentages(100, 90, 100, 0, 0, 0, 0)
        self.assertEqual(result['availability'], 'insufficient_coverage')
        self.assertIsNone(result['sfha_area_pct'])
        self.assertIsNone(result['annual_0_2_pct_area_pct'])
        self.assertIsNone(result['floodway_area_pct'])

    def test_undated_or_unknown_coverage_withholds_values(self):
        self.assertIsNone(flood.complete_percentages(100, 100, 0, 0, 1, 2, 0)['sfha_area_pct'])
        self.assertIsNone(flood.complete_percentages(100, 100, 100, 1, 1, 2, 0)['sfha_area_pct'])

    def test_zero_is_valid_only_with_complete_classified_dated_coverage(self):
        result = flood.complete_percentages(100, 100, 100, 0, 0, 0, 0)
        self.assertEqual(result['sfha_area_pct'], 0)
        self.assertEqual(result['availability'], 'reference_summary')

    def test_invalid_future_sentinel_dates_are_not_effective(self):
        today = datetime(2026, 9, 19, tzinfo=timezone.utc)
        self.assertIsNone(flood.effective_date(None, today))
        self.assertIsNone(flood.effective_date('2020', today))
        self.assertIsNone(flood.effective_date(datetime(2027, 1, 1, tzinfo=timezone.utc).timestamp() * 1000, today))
        self.assertEqual(flood.effective_date(datetime(2007, 6, 18, tzinfo=timezone.utc).timestamp() * 1000, today), '2007-06-18')


if __name__ == '__main__':
    unittest.main()
