-- Run after the repair migration and all 88 boundaries are installed.
-- Every fixture, source replacement and staged row is rolled back.
begin;
do $$
declare
  src jsonb; feature jsonb; good_geometry jsonb; bad_geometry jsonb;
  invalid_payload jsonb; expected_error text; caught boolean;
  before_source jsonb; after_source jsonb; before_places jsonb; after_places jsonb;
begin
  if (select count(*) from public.neighborhood_boundaries)<>88 then raise exception 'Test requires 88 published boundaries'; end if;
  if exists(select 1 from public.neighborhood_sources where source_id='test_geo_repair') then raise exception 'Test source ID already exists'; end if;
  select extensions.st_asgeojson(extensions.st_pointonsurface(geom))::jsonb into good_geometry
    from public.neighborhood_boundaries where neighborhood_id=1;
  src:=jsonb_build_object(
    'source_id','test_geo_repair','category','parks','source_url','https://example.com/rollback-fixture',
    'source_checked_at',now(),'source_published_at',null,'source_period',null,
    'source_count',1,'attribution','Rollback test','note','Not a real public source. Rolled back.',
    'data_version','rollback-good'
  );
  feature:=jsonb_build_object('type','Feature','id','test_geo_repair:1',
    'properties',jsonb_build_object('source_id','test_geo_repair','source_object_id','1',
      'category','parks','name','Rollback fixture','address',null),
    'geometry',good_geometry);
  perform public.stage_geo_import('rollback_geo_repair:good',jsonb_build_array(feature));
  perform public.publish_neighborhood_places('rollback_geo_repair:good',src);
  select to_jsonb(s) into before_source from public.neighborhood_sources s where source_id='test_geo_repair';
  select jsonb_agg(to_jsonb(p) order by place_id) into before_places from public.neighborhood_places p where source_id='test_geo_repair';
  if before_source->>'geometry_repair_count'<>'0' or jsonb_array_length(before_places)<>1 then raise exception 'Baseline publication failed'; end if;

  -- Invalid staging must fail before changing any published source or place.
  for invalid_payload in select p from (values
    (null::jsonb),('null'::jsonb),('{}'::jsonb),('[]'::jsonb),
    ('[{"type":"Feature","id":null}]'::jsonb),
    (jsonb_build_array(feature,jsonb_build_object('type','Feature','id',null)))
  ) invalid(p) loop
    caught:=false;
    begin
      perform public.stage_geo_import('rollback_geo_repair:malformed',invalid_payload);
    exception when others then caught:=true;
    end;
    if not caught then raise exception 'Malformed staging unexpectedly succeeded'; end if;
    if exists(select 1 from hou_match_private.geo_import_features where batch_id='rollback_geo_repair:malformed') then raise exception 'Malformed staging left partial rows'; end if;
  end loop;

  -- Each rejected replacement updates source metadata and deletes prior places
  -- before validation. Its exception must roll the entire replacement back.
  for bad_geometry,expected_error in select g,err from (values
    ('{"type":"Polygon","coordinates":[[[-95.4,29.7],[-95.38,29.72],[-95.4,29.72],[-95.38,29.7],[-95.4,29.7]]]}'::jsonb,
      'Polygon repair changes area beyond tolerance%'),
    ('{"type":"Polygon","coordinates":[[[-95.4,29.7],[-95.39,29.7],[-95.38,29.7],[-95.4,29.7]]]}'::jsonb,
      'Unsafe polygon repair result%'),
    ('{"type":"Point","coordinates":[3000000,13000000]}'::jsonb,
      'Invalid facility geometry%')
  ) invalid(g,err) loop
    perform public.stage_geo_import('rollback_geo_repair:invalid',jsonb_build_array(jsonb_set(feature,'{geometry}',bad_geometry)));
    caught:=false;
    begin
      perform public.publish_neighborhood_places('rollback_geo_repair:invalid',jsonb_set(src,'{data_version}','"rollback-bad"'::jsonb));
    exception when others then
      if sqlerrm not like expected_error then raise exception 'Unexpected validation failure: %',sqlerrm; end if;
      caught:=true;
    end;
    if not caught then raise exception 'Invalid geometry unexpectedly replaced valid published data'; end if;
    select to_jsonb(s) into after_source from public.neighborhood_sources s where source_id='test_geo_repair';
    select jsonb_agg(to_jsonb(p) order by place_id) into after_places from public.neighborhood_places p where source_id='test_geo_repair';
    if after_source is distinct from before_source or after_places is distinct from before_places then
      raise exception 'Failed replacement changed previously published source or places';
    end if;
    if not exists(select 1 from hou_match_private.geo_import_features where batch_id='rollback_geo_repair:invalid') then
      raise exception 'Rejected source staging was unexpectedly consumed';
    end if;
  end loop;
end;
$$;
rollback;
select 'Passed: malformed staging, material area change, dimensional collapse, projected point, and atomic preservation; all fixtures rolled back.' as result;
