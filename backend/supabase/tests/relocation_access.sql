begin;
do $$
declare original jsonb; source jsonb; rows jsonb; result jsonb; failed boolean:=false; version text;
begin
  original:=public.get_neighborhood_scoring_data();
  select boundary_version into version from public.neighborhood_boundaries limit 1;
  source:=jsonb_build_object('source_id','hpd_crime_2024','kind','reported_crime','source_url','https://example.org/crime',
    'source_sha256',repeat('a',64),'source_period','2024 historical fixture','source_checked_at',now(),'refresh_due_at',now()+interval '1 day',
    'boundary_version',version,'data_version','relocation-0000000000000000','attribution','Test',
    'limitations',jsonb_build_array('Historical selected counts, not rates'),'audit','{}'::jsonb);
  select jsonb_agg(jsonb_build_object('neighborhood_id',n,'facts',jsonb_build_object('year',2024,'source_neighborhood_name','test',
    'counts',jsonb_build_object('aggravated_assault',1,'robbery',2,'burglary',null,'motor_vehicle_theft',0,'theft_from_motor_vehicle',3))))
    into rows from generate_series(1,88) n;
  perform public.publish_neighborhood_supplement(source,rows);
  assert (select count(*) from public.neighborhood_supplements)=88;
  result:=public.get_neighborhood_relocation_context(62);
  assert result#>>'{reported_crime,availability}'='historical_snapshot';
  assert result#>'{reported_crime,facts,counts,burglary}'='null'::jsonb;
  assert result#>'{safety,tier}'='null'::jsonb;
  assert result#>>'{transit,availability}'='unavailable';
  assert public.get_neighborhood_scoring_data()=original,'Supplement changed scoring';
  begin
    perform public.publish_neighborhood_supplement(source,rows-0);
  exception when others then failed:=true; end;
  assert failed,'Malformed cohort accepted';
  failed:=false;
  begin
    perform public.publish_neighborhood_supplement(source,jsonb_set(rows,'{87,neighborhood_id}','1'::jsonb));
  exception when others then failed:=true; end;
  assert failed,'Duplicate IDs accepted';
  assert (select facts#>'{counts,robbery}' from public.neighborhood_supplements where source_id='hpd_crime_2024' and neighborhood_id=62)='2'::jsonb,'Failed publish corrupted existing data';
  source:=source||jsonb_build_object('source_id','metro_gtfs','kind','transit','source_period','Synthetic SQL fixture',
    'audit',jsonb_build_object('feed_start_date',current_date,'feed_end_date',current_date+10));
  select jsonb_agg(jsonb_build_object('neighborhood_id',n,'facts',jsonb_build_object(
    'stop_count',0,'active_route_count',0,'rail_stop_count',0,'routes','[]'::jsonb,
    'service_dates',(select jsonb_agg(to_char(current_date+d,'YYYY-MM-DD') order by d) from generate_series(0,6) d),
    'nearest_stops',jsonb_build_array(jsonb_build_object('stop_id','fixture','name','Test','latitude',29.75,'longitude',-95.35,
      'straight_line_meters',100,'inside_neighborhood',false,'route_ids',jsonb_build_array('r'),'neighborhood_ids','[]'::jsonb)))))
    into rows from generate_series(1,88) n;
  perform public.publish_neighborhood_supplement(source,rows);
  assert (select count(*) from public.neighborhood_supplements)=176;
  assert public.get_neighborhood_relocation_context(62)#>>'{transit,availability}'='scheduled_snapshot';
  assert public.get_neighborhood_scoring_data()=original,'Transit changed scoring';
  failed:=false;
  begin
    perform public.publish_neighborhood_supplement(source,jsonb_set(rows,'{87,facts,service_dates,1}',to_jsonb(to_char(current_date+8,'YYYY-MM-DD'))));
  exception when others then failed:=true; end;
  assert failed,'Nonconsecutive service dates accepted';
  assert not has_function_privilege('anon','public.publish_neighborhood_supplement(jsonb,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.publish_neighborhood_supplement(jsonb,jsonb)','execute');
  assert not has_table_privilege('anon','public.neighborhood_supplements','insert');
  assert not has_table_privilege('authenticated','public.neighborhood_supplement_sources','update');
end;
$$;
set local role anon;
do $$ declare b jsonb; begin
  b:=public.get_neighborhood_relocation_context(62);
  assert b->>'scoring_effect'='none';
  assert b#>>'{housing,availability}'='partial';
  assert b#>>'{reported_crime,availability}'='historical_snapshot';
  begin perform public.get_neighborhood_relocation_context(null); raise exception 'NULL accepted';
    exception when invalid_parameter_value then null; end;
end $$;
reset role;
update public.neighborhood_supplement_sources set source_checked_at=now()-interval '2 days',refresh_due_at=now()-interval '1 day';
set local role authenticated;
do $$ declare b jsonb; begin
  b:=public.get_neighborhood_relocation_context(62);
  assert b#>>'{reported_crime,availability}'='needs_refresh';
  assert b#>'{reported_crime,facts}'='null'::jsonb;
  assert b#>'{transit,facts}'='null'::jsonb;
end $$;
reset role;
update public.neighborhood_supplement_sources set source_checked_at=now(),refresh_due_at=now()+interval '1 day',boundary_version='obsolete';
do $$ begin
  assert public.get_neighborhood_relocation_context(62)#>'{reported_crime,facts}'='null'::jsonb,'Obsolete boundary facts leaked';
end $$;
rollback;
select 'relocation_access_passed' as result;
