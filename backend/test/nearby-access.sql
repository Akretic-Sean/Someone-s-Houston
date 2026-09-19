-- Run after the nearby_access_scoring migration. Every fixture mutation rolls back.
begin;
set local role anon;
do $$
declare body jsonb; eastwood jsonb;
begin
  body := public.get_neighborhood_access_scoring_data();
  assert body#>>'{base,model_version}'='houston-access-v2';
  assert jsonb_array_length(body#>'{base,neighborhoods}')=88;
  assert public.get_neighborhood_scoring_data()->>'model_version'='houston-proximity-v1';
  select n into eastwood from jsonb_array_elements(body#>'{base,neighborhoods}') n where n->>'neighborhood_id'='64';
  -- Regression: count the complete radius inventory, not only the three displayed nearest.
  assert (eastwood#>>'{categories,amen,nearby_access,facilities,libraries,count}')::int>3;
  assert (eastwood#>>'{categories,health,nearby_access,facilities,hospitals,count}')::int>3;
end $$;
reset role;
-- An incomplete source must withhold counts even if old nearest facts remain.
update public.neighborhood_sources set published_count=published_count-1 where category='libraries';
do $$
declare n jsonb;
begin
  select row into n from jsonb_array_elements(public.get_neighborhood_access_scoring_data()#>'{base,neighborhoods}') row where row->>'neighborhood_id'='64';
  assert n#>'{categories,amen,nearby_access,facilities,libraries}'='null'::jsonb;
  assert (n#>>'{categories,health,nearby_access,facilities,hospitals,count}')::int>0;
end $$;
update public.neighborhood_category_evidence set refresh_due_at=now()-interval '1 second' where category_id='health' and neighborhood_id=64;
do $$
declare n jsonb;
begin
  select row into n from jsonb_array_elements(public.get_neighborhood_access_scoring_data()#>'{base,neighborhoods}') row where row->>'neighborhood_id'='64';
  assert n#>>'{categories,health,availability}'='needs_refresh';
  assert n#>'{categories,health,nearby_access,facilities,hospitals}'='null'::jsonb;
end $$;
rollback;
