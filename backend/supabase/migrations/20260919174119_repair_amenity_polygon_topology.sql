-- Preserve provenance for narrowly bounded topology repairs of public source polygons.
alter table public.neighborhood_sources add column geometry_repair_count integer not null default 0
  check (geometry_repair_count between 0 and source_count);
comment on column public.neighborhood_sources.geometry_repair_count is
  'Number of source polygon features repaired with ST_MakeValid before neighborhood filtering. Geography area change must be <= 1 part per million, with a 0.000001 m² numerical floor. The source snapshot retains original geometry.';

create or replace function public.publish_neighborhood_places(p_batch text, p_source jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f jsonb; g extensions.geometry; pt extensions.geometry; ids smallint[]; published integer:=0;
  sid text:=p_source->>'source_id'; cat text:=p_source->>'category'; current_boundary_version text; repaired extensions.geometry;
  original_area double precision; repaired_area double precision; repair_count integer:=0;
begin
  lock table public.neighborhood_boundaries in share mode;
  select case when count(*)=88 and count(distinct boundary_version)=1 then min(boundary_version) end
    into current_boundary_version from public.neighborhood_boundaries;
  if current_boundary_version is null then raise exception 'Import a complete single boundary edition first'; end if;
  if (select count(*) from hou_match_private.geo_import_features where batch_id=p_batch)<>(p_source->>'source_count')::integer then raise exception 'Incomplete facility source'; end if;
  if (p_source->>'source_count')::integer < 1 then raise exception 'Empty facility source needs manual review'; end if;
  insert into public.neighborhood_sources(
    source_id,category,source_url,source_checked_at,source_published_at,source_period,
    source_count,published_count,attribution,note,data_version,boundary_version,geometry_repair_count
  ) values(
    sid,cat,p_source->>'source_url',(p_source->>'source_checked_at')::timestamptz,
    (p_source->>'source_published_at')::timestamptz,p_source->>'source_period',
    (p_source->>'source_count')::integer,0,p_source->>'attribution',p_source->>'note',
    (p_source->>'data_version')||':'||current_boundary_version,current_boundary_version,0
  ) on conflict(source_id) do update set
    category=excluded.category,source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,
    source_published_at=excluded.source_published_at,source_period=excluded.source_period,
    source_count=excluded.source_count,published_count=0,attribution=excluded.attribution,
    note=excluded.note,data_version=excluded.data_version,boundary_version=excluded.boundary_version,geometry_repair_count=0;
  delete from public.neighborhood_places where source_id=sid;
  for f in select feature from hou_match_private.geo_import_features where batch_id=p_batch loop
    if f->'properties'->>'source_id' is distinct from sid or f->'properties'->>'category' is distinct from cat then raise exception 'Mixed facility source'; end if;
    g:=extensions.st_geomfromgeojson(f->'geometry');
    -- Regional inventories contain valid records outside Houston. Validate those
    -- coordinates before the neighborhood intersection filter discards them.
    if g is null or extensions.st_srid(g)<>4326 or extensions.geometrytype(g) not in ('POINT','POLYGON','MULTIPOLYGON') or extensions.st_isempty(g)
      or not extensions.st_coveredby(extensions.st_envelope(g),extensions.st_makeenvelope(-97.5,28,-94,31.5,4326)) then
      raise exception 'Invalid facility geometry %',f->>'id';
    end if;
    if not extensions.st_isvalid(g) then
      if extensions.geometrytype(g) not in ('POLYGON','MULTIPOLYGON') then raise exception 'Invalid point geometry %',f->>'id'; end if;
      -- ST_MakeValid linework keeps source vertices. Never extract polygon parts
      -- from a collapsed GeometryCollection: dimensional loss requires review.
      original_area:=extensions.st_area(g::extensions.geography);
      if not (original_area>0 and original_area<1e11) then raise exception 'Unsafe polygon repair area %',f->>'id'; end if;
      repaired:=extensions.st_makevalid(g);
      if repaired is null or extensions.geometrytype(repaired) not in ('POLYGON','MULTIPOLYGON') or extensions.st_srid(repaired)<>4326
        or extensions.st_isempty(repaired) or not extensions.st_isvalid(repaired) then raise exception 'Unsafe polygon repair result %',f->>'id'; end if;
      repaired_area:=extensions.st_area(repaired::extensions.geography);
      -- At most one part per million area change (0.0001%), with a numerical
      -- floor of 0.000001 square meter. Material area changes fail closed.
      if not (repaired_area>0 and repaired_area<1e11) or abs(repaired_area-original_area)>greatest(original_area*0.000001,0.000001) then
        raise exception 'Polygon repair changes area beyond tolerance %',f->>'id';
      end if;
      g:=repaired;
      repair_count:=repair_count+1;
    end if;
    if not extensions.st_coveredby(g,extensions.st_makeenvelope(-97.5,28,-94,31.5,4326)) then raise exception 'Repaired geometry outside regional extent %',f->>'id'; end if;
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
  update public.neighborhood_sources set published_count=published,geometry_repair_count=repair_count,
    note=case when repair_count>0 then (p_source->>'note')||format(
      ' %s input polygon geometries received ST_MakeValid linework topology repair; each retained area within 0.0001%% (minimum numerical tolerance 0.000001 m²). Raw source geometries are preserved in the import snapshot.',repair_count)
      else p_source->>'note' end
    where source_id=sid;
  delete from hou_match_private.geo_import_features where batch_id=p_batch;
  return jsonb_build_object('source_id',sid,'source_count',(p_source->>'source_count')::integer,'published',published,'boundary_version',current_boundary_version,'geometry_repair_count',repair_count);
end;
$$;

-- get_neighborhood_places already returns to_jsonb(source), so repair provenance
-- is included in its source metadata without duplicating the read function.
revoke all on function public.publish_neighborhood_places(text,jsonb) from public, anon, authenticated;
grant execute on function public.publish_neighborhood_places(text,jsonb) to service_role;
