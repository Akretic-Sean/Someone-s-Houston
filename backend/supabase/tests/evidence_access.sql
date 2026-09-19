begin;
do $$
declare result jsonb;
begin
  if (select count(*) from public.neighborhood_category_evidence)<>704 then raise exception 'Expected 704 published evidence rows'; end if;
  if has_table_privilege('anon','public.neighborhood_category_evidence','INSERT') or
     has_table_privilege('authenticated','public.neighborhood_category_evidence','UPDATE') or
     has_function_privilege('anon','public.publish_neighborhood_evidence(text)','EXECUTE') or
     has_function_privilege('authenticated','public.stage_geo_import(text,jsonb)','EXECUTE') then raise exception 'Public write access'; end if;
  if public.evidence_sources_valid('[{}]'::jsonb) then raise exception 'Empty provenance accepted'; end if;
  begin
    perform public.publish_neighborhood_evidence('test:missing');
    raise exception 'Incomplete release accepted';
  exception when raise_exception then if sqlerrm='Incomplete release accepted' then raise; end if; end;
end;
$$;
set local role anon;
do $$
declare result jsonb;
begin
  result:=public.get_neighborhood_evidence(62);
  if jsonb_array_length(result->'neighborhoods')<>1 or jsonb_array_length(result->'category_definitions')<>8 then raise exception 'Wrong evidence scope'; end if;
  if result->'safety'->'tier'<>'null'::jsonb then raise exception 'Fabricated safety tier'; end if;
  if (result->'neighborhoods'->0->'categories'->'afford'->'facts'->>'median_gross_rent_monthly_usd')::int<>1811 then raise exception 'Midtown rent mismatch'; end if;
  result:=public.get_neighborhood_evidence(7);
  if result->'neighborhoods'->0->'categories'->'afford'->'facts'->'median_gross_rent_monthly_usd'<>'null'::jsonb then raise exception 'Missing rent replaced'; end if;
  begin perform public.get_neighborhood_evidence(0); raise exception 'Bad ID accepted'; exception when invalid_parameter_value then null; end;
end;
$$;
reset role;
update public.neighborhood_category_evidence set prepared_at=now()-interval '2 days',refresh_due_at=now()-interval '1 day' where neighborhood_id=62 and category_id='food';
update public.neighborhood_profiles set data_version='coh-sn-2024-0000000000000000' where neighborhood_id=7;
update public.neighborhood_sources set data_version='test-new-source' where source_id=(select source_id from public.neighborhood_sources where category='parks' limit 1);
set local role anon;
do $$
declare result jsonb;
begin
  result:=public.get_neighborhood_evidence(62)->'neighborhoods'->0->'categories';
  if result->'food'->>'availability'<>'needs_refresh' or result->'food'->'facts'<>'null'::jsonb then raise exception 'Expired facts leaked'; end if;
  if result->'fit'->>'availability'<>'needs_refresh' then raise exception 'Place source drift not detected'; end if;
  result:=public.get_neighborhood_evidence(7)->'neighborhoods'->0->'categories';
  if result->'afford'->>'availability'<>'needs_refresh' or result->'air'->>'availability'<>'needs_refresh' then raise exception 'Profile/center drift not detected'; end if;
end;
$$;
rollback;
