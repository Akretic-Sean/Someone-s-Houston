create extension if not exists postgis with schema extensions;
create schema if not exists hou_match_private;
revoke all on schema hou_match_private from public, anon, authenticated;
grant usage on schema hou_match_private to service_role;

-- Private bounded staging lets large GeoJSON uploads publish atomically after validation.
create table hou_match_private.geo_import_features (
  batch_id text not null check (batch_id ~ '^[A-Za-z0-9_:-]{1,120}$'),
  feature_id text not null check (length(feature_id) between 1 and 120),
  feature jsonb not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, feature_id)
);
alter table hou_match_private.geo_import_features enable row level security;
revoke all on hou_match_private.geo_import_features from public, anon, authenticated;
grant select, insert, update, delete on hou_match_private.geo_import_features to service_role;

create table public.neighborhood_boundaries (
  neighborhood_id smallint primary key references public.neighborhood_profiles(neighborhood_id),
  geom extensions.geometry(MultiPolygon,4326) not null,
  boundary_version text not null,
  source_checked_at timestamptz not null,
  source_data_last_edit_at timestamptz,
  check (extensions.st_isvalid(geom)),
  check (not extensions.st_isempty(geom))
);
create index neighborhood_boundaries_geom_idx on public.neighborhood_boundaries using gist(geom);

create table public.neighborhood_sources (
  source_id text primary key check (source_id ~ '^[a-z_]{1,60}$'),
  category text not null,
  source_url text not null check (source_url like 'https://%'),
  source_checked_at timestamptz not null,
  source_published_at timestamptz,
  source_period text,
  source_count integer not null check (source_count between 0 and 5000),
  published_count integer not null check (published_count between 0 and source_count),
  attribution text not null,
  note text not null,
  data_version text not null
);

create table public.neighborhood_places (
  place_id text primary key,
  source_id text not null references public.neighborhood_sources(source_id),
  source_object_id text not null,
  category text not null check (category in ('parks','libraries','community_centers','hospitals','health_facilities','multi_service_centers','museums','schools')),
  name text not null check (length(name) between 1 and 300),
  address text,
  latitude double precision not null check (latitude between 29 and 31),
  longitude double precision not null check (longitude between -96.5 and -94.5),
  neighborhood_ids smallint[] not null check (cardinality(neighborhood_ids) between 1 and 88),
  location_method text not null check (location_method in ('source_point','point_on_surface')),
  unique(source_id,source_object_id)
);
create index neighborhood_places_neighborhood_idx on public.neighborhood_places using gin(neighborhood_ids);

create table public.live_context (
  source_id text primary key check (source_id in ('nws_alerts','usgs_gauges')),
  source_url text not null check (source_url like 'https://%'),
  source_checked_at timestamptz not null,
  source_published_at timestamptz,
  valid_until timestamptz not null check (valid_until > source_checked_at),
  payload jsonb not null check (payload->>'type' = 'FeatureCollection' and jsonb_typeof(payload->'features')='array'),
  record_count integer not null check (record_count between 0 and 500),
  attribution text not null,
  note text not null,
  check (jsonb_array_length(payload->'features') = record_count),
  check (octet_length(payload::text) < 1000000)
);

alter table public.neighborhood_boundaries enable row level security;
alter table public.neighborhood_sources enable row level security;
alter table public.neighborhood_places enable row level security;
alter table public.live_context enable row level security;
revoke all on public.neighborhood_boundaries, public.neighborhood_sources, public.neighborhood_places, public.live_context from public, anon, authenticated, service_role;
grant select on public.neighborhood_boundaries, public.neighborhood_sources, public.neighborhood_places, public.live_context to anon, authenticated;
grant select, insert, update, delete on public.neighborhood_boundaries, public.neighborhood_sources, public.neighborhood_places, public.live_context to service_role;
create policy "Public boundary reads" on public.neighborhood_boundaries for select to anon, authenticated using(true);
create policy "Public source reads" on public.neighborhood_sources for select to anon, authenticated using(true);
create policy "Public facility reads" on public.neighborhood_places for select to anon, authenticated using(true);
create policy "Public current context reads" on public.live_context for select to anon, authenticated using(true);

create function public.stage_geo_import(p_batch text, p_features jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  if jsonb_typeof(p_features) <> 'array' or jsonb_array_length(p_features) not between 1 and 100 or octet_length(p_features::text)>2000000 then
    raise exception 'Invalid or oversized staging batch';
  end if;
  delete from hou_match_private.geo_import_features where created_at < now()-interval '1 day';
  insert into hou_match_private.geo_import_features(batch_id,feature_id,feature)
    select p_batch, value->>'id', value from jsonb_array_elements(p_features)
    on conflict(batch_id,feature_id) do update set feature=excluded.feature,created_at=now();
  get diagnostics n=row_count;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)>5000 then raise exception 'Import exceeds 5000 features'; end if;
  return n;
end;
$$;

create function public.publish_neighborhood_boundaries(p_batch text, p_manifest jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f jsonb; g extensions.geometry; ident smallint; version text:=p_manifest->>'boundary_version';
begin
  if version !~ '^coh-sn-boundaries-[a-f0-9]{16}$' or version is null then raise exception 'Invalid boundary version'; end if;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)<>88 then raise exception 'Exactly 88 boundaries required'; end if;
  for f in select feature from hou_match_private.geo_import_features where batch_id=p_batch loop
    ident:=(f->>'id')::smallint;
    if not exists(select 1 from public.neighborhood_profiles where neighborhood_id=ident and name=f->'properties'->>'name') then raise exception 'Unknown boundary ID/name %',ident; end if;
    g:=extensions.st_multi(extensions.st_geomfromgeojson(f->'geometry'));
    if extensions.st_srid(g)<>4326 or extensions.geometrytype(g)<>'MULTIPOLYGON' or not extensions.st_isvalid(g) or extensions.st_isempty(g) or not extensions.st_coveredby(g,extensions.st_makeenvelope(-96.5,29,-94.5,31,4326)) then
      raise exception 'Invalid boundary geometry for %',ident;
    end if;
    insert into public.neighborhood_boundaries values(ident,g,version,(p_manifest->>'source_checked_at')::timestamptz,(p_manifest->>'source_data_last_edit_at')::timestamptz)
      on conflict(neighborhood_id) do update set geom=excluded.geom,boundary_version=excluded.boundary_version,source_checked_at=excluded.source_checked_at,source_data_last_edit_at=excluded.source_data_last_edit_at;
  end loop;
  delete from hou_match_private.geo_import_features where batch_id=p_batch;
  return jsonb_build_object('published',88,'boundary_version',version);
end;
$$;

create function public.publish_neighborhood_places(p_batch text, p_source jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f jsonb; g extensions.geometry; pt extensions.geometry; ids smallint[]; published integer:=0; sid text:=p_source->>'source_id'; cat text:=p_source->>'category';
begin
  if (select count(*) from public.neighborhood_boundaries)<>88 then raise exception 'Import boundaries first'; end if;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)<>(p_source->>'source_count')::integer then raise exception 'Incomplete facility source'; end if;
  if (p_source->>'source_count')::integer < 1 then raise exception 'Empty facility source needs manual review'; end if;
  insert into public.neighborhood_sources values(sid,cat,p_source->>'source_url',(p_source->>'source_checked_at')::timestamptz,(p_source->>'source_published_at')::timestamptz,p_source->>'source_period',(p_source->>'source_count')::integer,0,p_source->>'attribution',p_source->>'note',p_source->>'data_version')
    on conflict(source_id) do update set category=excluded.category,source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,source_published_at=excluded.source_published_at,source_period=excluded.source_period,source_count=excluded.source_count,published_count=0,attribution=excluded.attribution,note=excluded.note,data_version=excluded.data_version;
  delete from public.neighborhood_places where source_id=sid;
  for f in select feature from hou_match_private.geo_import_features where batch_id=p_batch loop
    if f->'properties'->>'source_id' is distinct from sid or f->'properties'->>'category' is distinct from cat then raise exception 'Mixed facility source'; end if;
    g:=extensions.st_geomfromgeojson(f->'geometry');
    if extensions.st_srid(g)<>4326 or extensions.geometrytype(g) not in ('POINT','POLYGON','MULTIPOLYGON') or not extensions.st_isvalid(g) or extensions.st_isempty(g) or not extensions.st_coveredby(g,extensions.st_makeenvelope(-96.5,29,-94.5,31,4326)) then
      raise exception 'Invalid facility geometry %',f->>'id';
    end if;
    select array_agg(neighborhood_id order by neighborhood_id) into ids from public.neighborhood_boundaries b
      where extensions.st_intersects(b.geom,g);
    if ids is null then continue; end if; -- Only publish features intersecting our Houston coverage.
    pt:=extensions.st_pointonsurface(g);
    insert into public.neighborhood_places values(f->>'id',sid,f->'properties'->>'source_object_id',cat,f->'properties'->>'name',f->'properties'->>'address',extensions.st_y(pt),extensions.st_x(pt),ids,case when extensions.geometrytype(g)='POINT' then 'source_point' else 'point_on_surface' end);
    published:=published+1;
  end loop;
  if published=0 then raise exception 'No facilities intersect Houston; review source before replacing'; end if;
  update public.neighborhood_sources set published_count=published where source_id=sid;
  delete from hou_match_private.geo_import_features where batch_id=p_batch;
  return jsonb_build_object('source_id',sid,'source_count',(p_source->>'source_count')::integer,'published',published);
end;
$$;

create function public.get_neighborhood_map()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('type','FeatureCollection','features',coalesce(jsonb_agg(jsonb_build_object(
    'type','Feature','id',b.neighborhood_id,
    'properties',jsonb_build_object('neighborhood_id',b.neighborhood_id,'name',p.name,'boundary_version',b.boundary_version,'source_checked_at',b.source_checked_at),
    'geometry',extensions.st_asgeojson(extensions.st_forcepolygonccw(extensions.st_simplifypreservetopology(b.geom,0.00003)),6,0)::jsonb
  ) order by b.neighborhood_id),'[]'::jsonb))
  from public.neighborhood_boundaries b join public.neighborhood_profiles p using(neighborhood_id);
$$;

create function public.get_neighborhood_places(p_neighborhood_id integer,p_category text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare output jsonb;
begin
  if p_neighborhood_id not between 1 and 88 or p_neighborhood_id is null then raise exception 'Neighborhood ID must be 1-88' using errcode='22023'; end if;
  if p_category is not null and p_category not in ('parks','libraries','community_centers','hospitals','health_facilities','multi_service_centers','museums','schools') then raise exception 'Unknown category' using errcode='22023'; end if;
  select jsonb_build_object('type','FeatureCollection','neighborhood_id',p_neighborhood_id,'features',coalesce(jsonb_agg(jsonb_build_object(
    'type','Feature','id',place_id,'geometry',jsonb_build_object('type','Point','coordinates',jsonb_build_array(longitude,latitude)),
    'properties',jsonb_build_object('name',name,'address',address,'category',category,'source_id',source_id,'neighborhood_ids',neighborhood_ids,'location_method',location_method)
  ) order by category,name),'[]'::jsonb)) into output from public.neighborhood_places where neighborhood_ids @> array[p_neighborhood_id::smallint] and (p_category is null or category=p_category);
  return output || jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(s) order by source_id),'[]'::jsonb) from public.neighborhood_sources s where p_category is null or category=p_category));
end;
$$;

create function public.get_current_context(p_neighborhood_id integer default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb:='[]'::jsonb; wanted text; feed public.live_context; kept jsonb; shape extensions.geometry;
begin
  if p_neighborhood_id is not null then
    if p_neighborhood_id not between 1 and 88 then raise exception 'Neighborhood ID must be 1-88' using errcode='22023'; end if;
    select geom into shape from public.neighborhood_boundaries where neighborhood_id=p_neighborhood_id;
    if shape is null then raise exception 'Neighborhood boundary unavailable'; end if;
  end if;
  foreach wanted in array array['nws_alerts','usgs_gauges'] loop
    select * into feed from public.live_context where source_id=wanted;
    if not found then result:=result||jsonb_build_array(jsonb_build_object('source_id',wanted,'availability','unavailable','payload',null)); continue; end if;
    if feed.valid_until<=now() then result:=result||jsonb_build_array(to_jsonb(feed)||jsonb_build_object('availability','stale','payload',null)); continue; end if;
    select coalesce(jsonb_agg(f),'[]'::jsonb) into kept from jsonb_array_elements(feed.payload->'features') f
      where (f->'properties'->>'valid_until')::timestamptz>now()
      and (shape is null or f->'geometry'='null'::jsonb or f->'geometry' is null or extensions.st_intersects(shape,extensions.st_geomfromgeojson(f->'geometry')));
    result:=result||jsonb_build_array(to_jsonb(feed)||jsonb_build_object(
      'availability',case when wanted='usgs_gauges' and jsonb_array_length(kept)=0 then 'no_current_observations' else 'current' end,
      'record_count',jsonb_array_length(kept),'payload',jsonb_build_object('type','FeatureCollection','features',kept)));
  end loop;
  return jsonb_build_object('checked_at',now(),'neighborhood_id',p_neighborhood_id,'feeds',result);
end;
$$;

revoke all on function public.stage_geo_import(text,jsonb), public.publish_neighborhood_boundaries(text,jsonb), public.publish_neighborhood_places(text,jsonb) from public, anon, authenticated;
grant execute on function public.stage_geo_import(text,jsonb), public.publish_neighborhood_boundaries(text,jsonb), public.publish_neighborhood_places(text,jsonb) to service_role;
revoke all on function public.get_neighborhood_map(), public.get_neighborhood_places(integer,text), public.get_current_context(integer) from public;
grant execute on function public.get_neighborhood_map(), public.get_neighborhood_places(integer,text), public.get_current_context(integer) to anon, authenticated, service_role;

comment on table public.neighborhood_places is 'Public facility inventory, not opening status or quality. Parks may intersect multiple neighborhoods; representative points are not entrances.';
comment on table public.live_context is 'Latest successful operational feed only. Read through get_current_context to enforce expiry; failed refreshes never become empty/zero observations.';
