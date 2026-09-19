-- Reference-source memberships belong to the boundary edition used for their joins.
alter table public.neighborhood_sources add column boundary_version text not null
  check (boundary_version ~ '^coh-sn-boundaries-[a-f0-9]{16}$');

create or replace function public.stage_geo_import(p_batch text, p_features jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  if p_batch is null or p_batch !~ '^[A-Za-z0-9_:-]{1,120}$' then raise exception 'Invalid staging batch ID'; end if;
  if p_features is null or jsonb_typeof(p_features) is distinct from 'array' then raise exception 'Staging features must be an array'; end if;
  if jsonb_array_length(p_features) not between 1 and 100 or octet_length(p_features::text)>2000000 then
    raise exception 'Invalid or oversized staging batch';
  end if;
  if exists(select 1 from jsonb_array_elements(p_features) where
    jsonb_typeof(value) is distinct from 'object' or value->>'id' is null or length(value->>'id') not between 1 and 120
  ) then raise exception 'Each staged feature requires a non-null ID'; end if;
  delete from hou_match_private.geo_import_features where created_at < now()-interval '1 day';
  insert into hou_match_private.geo_import_features(batch_id,feature_id,feature)
    select p_batch, value->>'id', value from jsonb_array_elements(p_features)
    on conflict(batch_id,feature_id) do update set feature=excluded.feature,created_at=now();
  get diagnostics n=row_count;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)>5000 then raise exception 'Import exceeds 5000 features'; end if;
  return n;
end;
$$;

create or replace function public.publish_neighborhood_boundaries(p_batch text, p_manifest jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f jsonb; g extensions.geometry; ident smallint; version text:=p_manifest->>'boundary_version';
begin
  if version !~ '^coh-sn-boundaries-[a-f0-9]{16}$' or version is null then raise exception 'Invalid boundary version'; end if;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)<>88 then raise exception 'Exactly 88 boundaries required'; end if;
  -- Validate text before casting, so aliases such as "01" cannot overwrite ID 1.
  if exists(select 1 from hou_match_private.geo_import_features where batch_id=p_batch and (
    feature->>'id' is null or feature->>'id' !~ '^([1-9]|[1-7][0-9]|8[0-8])$'
    or feature_id is distinct from feature->>'id'
  )) then raise exception 'Boundary IDs must be canonical integers 1-88'; end if;
  if (select count(distinct (feature->>'id')::smallint) from hou_match_private.geo_import_features where batch_id=p_batch)<>88 then
    raise exception 'Exactly 88 distinct neighborhood IDs required';
  end if;
  -- Coordinate with facility joins so one publication sees one boundary edition.
  lock table public.neighborhood_boundaries in share row exclusive mode;
  for f in select feature from hou_match_private.geo_import_features where batch_id=p_batch order by (feature->>'id')::smallint loop
    ident:=(f->>'id')::smallint;
    if not exists(select 1 from public.neighborhood_profiles where neighborhood_id=ident and name=f->'properties'->>'name') then raise exception 'Unknown boundary ID/name %',ident; end if;
    g:=extensions.st_multi(extensions.st_geomfromgeojson(f->'geometry'));
    if g is null or extensions.st_srid(g)<>4326 or extensions.geometrytype(g)<>'MULTIPOLYGON' or not extensions.st_isvalid(g) or extensions.st_isempty(g) or not extensions.st_coveredby(g,extensions.st_makeenvelope(-96.5,29,-94.5,31,4326)) then
      raise exception 'Invalid boundary geometry for %',ident;
    end if;
    insert into public.neighborhood_boundaries(neighborhood_id,geom,boundary_version,source_checked_at,source_data_last_edit_at)
      values(ident,g,version,(p_manifest->>'source_checked_at')::timestamptz,(p_manifest->>'source_data_last_edit_at')::timestamptz)
      on conflict(neighborhood_id) do update set geom=excluded.geom,boundary_version=excluded.boundary_version,source_checked_at=excluded.source_checked_at,source_data_last_edit_at=excluded.source_data_last_edit_at;
  end loop;
  delete from hou_match_private.geo_import_features where batch_id=p_batch;
  return jsonb_build_object('published',88,'boundary_version',version);
end;
$$;

create or replace function public.publish_neighborhood_places(p_batch text, p_source jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f jsonb; g extensions.geometry; pt extensions.geometry; ids smallint[]; published integer:=0;
  sid text:=p_source->>'source_id'; cat text:=p_source->>'category'; current_boundary_version text;
begin
  lock table public.neighborhood_boundaries in share mode;
  select case when count(*)=88 and count(distinct boundary_version)=1 then min(boundary_version) end
    into current_boundary_version from public.neighborhood_boundaries;
  if current_boundary_version is null then raise exception 'Import a complete single boundary edition first'; end if;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)<>(p_source->>'source_count')::integer then raise exception 'Incomplete facility source'; end if;
  if (p_source->>'source_count')::integer < 1 then raise exception 'Empty facility source needs manual review'; end if;
  insert into public.neighborhood_sources(
    source_id,category,source_url,source_checked_at,source_published_at,source_period,
    source_count,published_count,attribution,note,data_version,boundary_version
  ) values(
    sid,cat,p_source->>'source_url',(p_source->>'source_checked_at')::timestamptz,
    (p_source->>'source_published_at')::timestamptz,p_source->>'source_period',
    (p_source->>'source_count')::integer,0,p_source->>'attribution',p_source->>'note',
    (p_source->>'data_version')||':'||current_boundary_version,current_boundary_version
  ) on conflict(source_id) do update set
    category=excluded.category,source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,
    source_published_at=excluded.source_published_at,source_period=excluded.source_period,
    source_count=excluded.source_count,published_count=0,attribution=excluded.attribution,
    note=excluded.note,data_version=excluded.data_version,boundary_version=excluded.boundary_version;
  delete from public.neighborhood_places where source_id=sid;
  for f in select feature from hou_match_private.geo_import_features where batch_id=p_batch loop
    if f->'properties'->>'source_id' is distinct from sid or f->'properties'->>'category' is distinct from cat then raise exception 'Mixed facility source'; end if;
    g:=extensions.st_geomfromgeojson(f->'geometry');
    -- Regional inventories contain valid records outside Houston. Validate those
    -- coordinates before the neighborhood intersection filter discards them.
    if g is null or extensions.st_srid(g)<>4326 or extensions.geometrytype(g) not in ('POINT','POLYGON','MULTIPOLYGON') or not extensions.st_isvalid(g) or extensions.st_isempty(g) or not extensions.st_coveredby(g,extensions.st_makeenvelope(-97.5,28,-94,31.5,4326)) then
      raise exception 'Invalid facility geometry %',f->>'id';
    end if;
    select array_agg(neighborhood_id order by neighborhood_id) into ids from public.neighborhood_boundaries b
      where extensions.st_intersects(b.geom,g);
    if ids is null then continue; end if;
    pt:=extensions.st_pointonsurface(g);
    insert into public.neighborhood_places(
      place_id,source_id,source_object_id,category,name,address,latitude,longitude,neighborhood_ids,location_method
    ) values(
      f->>'id',sid,f->'properties'->>'source_object_id',cat,f->'properties'->>'name',f->'properties'->>'address',
      extensions.st_y(pt),extensions.st_x(pt),ids,case when extensions.geometrytype(g)='POINT' then 'source_point' else 'point_on_surface' end
    );
    published:=published+1;
  end loop;
  if published=0 then raise exception 'No facilities intersect Houston; review source before replacing'; end if;
  update public.neighborhood_sources set published_count=published where source_id=sid;
  delete from hou_match_private.geo_import_features where batch_id=p_batch;
  return jsonb_build_object('source_id',sid,'source_count',(p_source->>'source_count')::integer,'published',published,'boundary_version',current_boundary_version);
end;
$$;

create or replace function public.get_neighborhood_places(p_neighborhood_id integer,p_category text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare output jsonb; current_boundary_version text;
begin
  if p_neighborhood_id not between 1 and 88 or p_neighborhood_id is null then raise exception 'Neighborhood ID must be 1-88' using errcode='22023'; end if;
  if p_category is not null and p_category not in ('parks','libraries','community_centers','hospitals','health_facilities','multi_service_centers','museums','schools') then raise exception 'Unknown category' using errcode='22023'; end if;
  select case when count(*)=88 and count(distinct boundary_version)=1 then min(boundary_version) end
    into current_boundary_version from public.neighborhood_boundaries;
  select jsonb_build_object('type','FeatureCollection','neighborhood_id',p_neighborhood_id,'features',coalesce(jsonb_agg(jsonb_build_object(
    'type','Feature','id',p.place_id,'geometry',jsonb_build_object('type','Point','coordinates',jsonb_build_array(p.longitude,p.latitude)),
    'properties',jsonb_build_object('name',p.name,'address',p.address,'category',p.category,'source_id',p.source_id,'neighborhood_ids',p.neighborhood_ids,'location_method',p.location_method)
  ) order by p.category,p.name),'[]'::jsonb)) into output
    from public.neighborhood_places p join public.neighborhood_sources s on s.source_id=p.source_id
    where p.neighborhood_ids @> array[p_neighborhood_id::smallint]
      and (p_category is null or p.category=p_category)
      and s.boundary_version=current_boundary_version;
  return output || jsonb_build_object('sources',(
    select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('availability',
      case when s.boundary_version=current_boundary_version then 'reference_snapshot' else 'needs_rejoin' end
    ) order by s.source_id),'[]'::jsonb)
    from public.neighborhood_sources s where p_category is null or s.category=p_category
  ));
end;
$$;

revoke all on function public.stage_geo_import(text,jsonb), public.publish_neighborhood_boundaries(text,jsonb), public.publish_neighborhood_places(text,jsonb) from public, anon, authenticated;
grant execute on function public.stage_geo_import(text,jsonb), public.publish_neighborhood_boundaries(text,jsonb), public.publish_neighborhood_places(text,jsonb) to service_role;
revoke all on function public.get_neighborhood_places(integer,text) from public;
grant execute on function public.get_neighborhood_places(integer,text) to anon, authenticated, service_role;

comment on column public.neighborhood_sources.boundary_version is 'Boundary edition used for spatial membership. The public places RPC hides obsolete joins until the source is republished.';
