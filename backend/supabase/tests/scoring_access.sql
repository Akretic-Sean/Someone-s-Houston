-- Run against the seeded reference database; all simulated changes roll back.
begin;
set local role anon;
do $$
declare payload jsonb; n jsonb; c jsonb;
begin
  payload:=public.get_neighborhood_scoring_data();
  if payload->>'model_version' is distinct from 'houston-proximity-v1' or jsonb_array_length(payload->'neighborhoods') is distinct from 88 then
    raise exception 'Wrong scoring dataset/model';
  end if;
  if octet_length(payload::text)>250000 then raise exception 'Scoring payload exceeds compact budget'; end if;
  for n in select value from jsonb_array_elements(payload->'neighborhoods') loop
    if (select count(*) from jsonb_object_keys(n->'categories')) is distinct from 8 then raise exception 'Incomplete categories'; end if;
    if (n->>'neighborhood_id')::int=7 and n#>'{categories,afford,metrics,rent_usd}' is distinct from 'null'::jsonb then
      raise exception 'Unknown rent manufactured'; end if;
    if (n->>'neighborhood_id')::int=62 and n#>'{categories,afford,metrics,rent_usd}' is distinct from '1811'::jsonb then
      raise exception 'Midtown metric mapping mismatch'; end if;
    if (n->>'neighborhood_id')::int=any(array[17,25,41,43,80]) and
      n#>'{categories,flood,metrics,sfha_area_pct}' is distinct from 'null'::jsonb then
      raise exception 'Withheld flood became a scoring input'; end if;
    for c in select value from jsonb_each(n->'categories') loop
      if exists(select 1 from jsonb_each(c->'metrics') m where jsonb_typeof(m.value) not in ('number','null')) then
        raise exception 'Metric was not numeric/null'; end if;
    end loop;
  end loop;
  if has_function_privilege('anon','public.publish_neighborhood_evidence(text)','EXECUTE') or
     has_table_privilege('anon','public.neighborhood_category_evidence','UPDATE') then raise exception 'Public writes enabled'; end if;
end;
$$;
reset role;
update public.neighborhood_category_evidence set prepared_at=now()-interval '2 days',refresh_due_at=now()-interval '1 day'
  where neighborhood_id=62 and category_id='food';
update public.neighborhood_profiles set data_version='coh-sn-2024-0000000000000000' where neighborhood_id=7;
update public.neighborhood_sources set data_version='test-scoring-new-source'
  where source_id=(select source_id from public.neighborhood_sources where category='parks' limit 1);
set local role anon;
do $$
declare payload jsonb; n jsonb;
begin
  payload:=public.get_neighborhood_scoring_data();
  select value into n from jsonb_array_elements(payload->'neighborhoods') where value->>'neighborhood_id'='62';
  if n#>>'{categories,food,availability}' is distinct from 'needs_refresh' or
     n#>'{categories,food,metrics,grocery_stores}' is distinct from 'null'::jsonb then raise exception 'Expired food leaked'; end if;
  if n#>>'{categories,fit,availability}' is distinct from 'needs_refresh' or
     n#>'{categories,fit,metrics,parks}' is distinct from 'null'::jsonb then raise exception 'Facility version drift leaked'; end if;
  select value into n from jsonb_array_elements(payload->'neighborhoods') where value->>'neighborhood_id'='7';
  if n#>>'{categories,commute,availability}' is distinct from 'needs_refresh' or
     n#>'{categories,commute,metrics,ion}' is distinct from 'null'::jsonb then raise exception 'Origin version drift leaked'; end if;
end;
$$;
rollback;
select 'scoring_access_passed' as result;
