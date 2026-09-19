-- Run after initial publication. Every mutation is rolled back.
begin;
do $$
declare r text; t text; fn text;
begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['neighborhood_boundaries','neighborhood_sources','neighborhood_places','live_context'] loop
      assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), 'RLS must be enabled';
      assert has_table_privilege(r,'public.'||t,'select'), 'Public source reads required';
      assert not has_table_privilege(r,'public.'||t,'insert,update,delete,truncate'), 'Client writes must be denied';
    end loop;
    assert not has_schema_privilege(r,'hou_match_private','usage'), 'Private staging must be inaccessible';
    foreach fn in array array['public.stage_geo_import(text,jsonb)','public.publish_neighborhood_boundaries(text,jsonb)','public.publish_neighborhood_places(text,jsonb)','hou_match_private.request_context_refresh()'] loop
      assert not has_function_privilege(r,fn,'execute'), 'Ingestion functions must be private';
    end loop;
  end loop;
  assert (select count(*)=88 and bool_and(extensions.st_isvalid(geom)) from public.neighborhood_boundaries), '88 valid canonical boundaries required';
  assert (select count(distinct boundary_version)=1 from public.neighborhood_boundaries), 'Boundary versions must agree';
end;
$$;
set local role anon;
do $$
begin
  assert jsonb_array_length(public.get_neighborhood_map()->'features')=88, 'Anonymous map RPC must return all neighborhoods';
  assert jsonb_array_length(public.get_neighborhood_places(62)->'sources')=8, 'All eight source manifests required';
  assert jsonb_array_length(public.get_current_context()->'feeds')=2, 'Both current feeds need explicit availability';
  begin
    perform public.stage_geo_import('forbidden','[]'::jsonb);
    raise exception 'Anonymous ingestion unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_neighborhood_places(0);
    raise exception 'Invalid ID unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.get_neighborhood_places(62,'invalid');
    raise exception 'Invalid category unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  assert jsonb_array_length(public.get_neighborhood_map()->'features')=88, 'Authenticated map reads must work';
  assert jsonb_array_length(public.get_neighborhood_places(62)->'sources')=8, 'Authenticated source reads must work';
  begin
    delete from public.live_context where source_id='nws_alerts';
    raise exception 'Authenticated delete unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
-- Expiry is enforced by the public RPC, independent of when ingestion ran.
update public.live_context set valid_until=now()-interval '1 second' where source_id='nws_alerts';
update public.live_context set valid_until=now()+interval '30 minutes',payload=jsonb_build_object('type','FeatureCollection','features',jsonb_build_array(jsonb_build_object(
  'type','Feature','id','expiry-test','geometry',jsonb_build_object('type','Point','coordinates',jsonb_build_array(-95.37,29.75)),
  'properties',jsonb_build_object('valid_until',now()-interval '1 second')
))),record_count=1 where source_id='usgs_gauges';
do $$
declare feeds jsonb;
begin
  feeds:=public.get_current_context()->'feeds';
  assert feeds->0->>'availability'='stale' and feeds->0->'payload'='null'::jsonb, 'Expired snapshot must be hidden';
  assert feeds->1->>'availability'='no_current_observations' and jsonb_array_length(feeds->1->'payload'->'features')=0, 'Expired observations must be hidden';
end;
$$;
delete from public.live_context where source_id='nws_alerts';
do $$
begin
  assert public.get_current_context()->'feeds'->0->>'availability'='unavailable', 'Missing feed must not look like zero alerts';
end;
$$;
rollback;
