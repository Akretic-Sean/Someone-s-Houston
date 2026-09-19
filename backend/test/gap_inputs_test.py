import importlib.util
import json
from pathlib import Path
import unittest
from shapely.geometry import box, mapping
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('gaps',ROOT/'tools/prepare-gap-inputs.py')
gaps=importlib.util.module_from_spec(spec);spec.loader.exec_module(gaps)

class GapTests(unittest.TestCase):
    def test_committed_receipts(self):
        rows=json.loads((ROOT/'data/neighborhood-gap-inputs.json').read_text(encoding='utf-8'))['rows']
        self.assertEqual(sorted(r['neighborhood_id'] for r in rows),[7,17,25,41,43,80])
        for r in rows:
            self.assertEqual(r['ranking_value'],r['upper_bound'])
            self.assertLessEqual(r['lower_bound'],r['upper_bound'])
            self.assertEqual(len(r['source_sha256']),64)
            if r['category_id']=='flood':
                self.assertLessEqual(r['upper_bound']-r['lower_bound'],5)
                self.assertTrue(all(m['complete_id_set_before_after'] for m in r['audit']['source_layers'].values()))

    def test_polygon_gap_and_conflict_widen_bounds(self):
        # Projected fixture; intercept projection only for this pure geometry check.
        from unittest.mock import patch
        def feat(geometry,**props):return {'properties':{'OBJECTID':1,**props},'geometry':mapping(geometry)}
        boundary=box(0,0,100,100)
        layers={0:[feat(boundary)],3:[feat(boundary,EFF_DATE=0)],28:[
            feat(box(0,0,20,100),FLD_ZONE='AE',SFHA_TF='T'),
            feat(box(19,0,99,100),FLD_ZONE='X',SFHA_TF='F',ZONE_SUBTY='AREA OF MINIMAL FLOOD HAZARD')]}
        with patch.object(gaps.flood,'prepare_geometry',side_effect=lambda f,r:gaps.shape(f['geometry'])):
            low,high,_=gaps.bounded_flood(boundary,layers)
        self.assertEqual(low,19)
        self.assertEqual(high,21)
        layers[28][1]=feat(box(19,0,90,100),FLD_ZONE='X',SFHA_TF='F',ZONE_SUBTY='AREA OF MINIMAL FLOOD HAZARD')
        with patch.object(gaps.flood,'prepare_geometry',side_effect=lambda f,r:gaps.shape(f['geometry'])):
            with self.assertRaises(ValueError):gaps.bounded_flood(boundary,layers)

if __name__=='__main__':unittest.main()
