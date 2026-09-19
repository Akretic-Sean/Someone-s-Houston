-- Optional public reference context. Existing evidence/scoring contracts are untouched.
create table public.neighborhood_supplement_sources (
  source_id text primary key check (source_id in ('metro_gtfs','hpd_crime_2024')),
  kind text not null unique check (kind in ('transit','reported_crime')),
  source_url text not null check (source_url ~ '^https://[^/]+/'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_period text not null check (length(source_period) between 1 and 500),
  source_checked_at timestamptz not null,
  refresh_due_at timestamptz not null,
  boundary_version text not null,
  data_version text not null check (data_version ~ '^relocation-[a-f0-9]{16}$'),
  attribution text not null,
  limitations jsonb not null check (jsonb_typeof(limitations)='array' and jsonb_array_length(limitations) between 1 and 10),
  audit jsonb not null check (jsonb_typeof(audit)='object' and octet_length(audit::text)<20000),
  check ((source_id='metro_gtfs' and kind='transit') or (source_id='hpd_crime_2024' and kind='reported_crime')),
  check (refresh_due_at > source_checked_at and refresh_due_at <= source_checked_at+interval '31 days')
);
create table public.neighborhood_supplements (
  source_id text not null references public.neighborhood_supplement_sources(source_id),
  neighborhood_id smallint not null references public.neighborhood_profiles(neighborhood_id),
  facts jsonb not null check (jsonb_typeof(facts)='object' and octet_length(facts::text) between 2 and 40000),
  primary key(source_id,neighborhood_id)
);
alter table public.neighborhood_supplement_sources enable row level security;
alter table public.neighborhood_supplements enable row level security;
revoke all on public.neighborhood_supplement_sources,public.neighborhood_supplements from public,anon,authenticated,service_role;
grant select on public.neighborhood_supplement_sources,public.neighborhood_supplements to anon,authenticated;
grant select,insert,update,delete on public.neighborhood_supplement_sources,public.neighborhood_supplements to service_role;
create policy supplement_source_read on public.neighborhood_supplement_sources for select to anon,authenticated using (true);
create policy supplement_read on public.neighborhood_supplements for select to anon,authenticated using (true);

create function public.publish_neighborhood_supplement(p_source jsonb,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_boundary text; r jsonb; f jsonb; k text; n numeric; sid text:=p_source->>'source_id';
begin
  if p_source is null or jsonb_typeof(p_source) is distinct from 'object' or
     p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Source and rows required' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows)<>88 or octet_length(p_rows::text)>2000000 then
    raise exception 'Exactly 88 bounded supplement rows required';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where
      jsonb_typeof(x->'neighborhood_id') is distinct from 'number' or
      coalesce(x->>'neighborhood_id','') !~ '^([1-9]|[1-7][0-9]|8[0-8])$') or
      (select count(distinct x->>'neighborhood_id') from jsonb_array_elements(p_rows) x)<>88 then
    raise exception 'Canonical complete cohort required';
  end if;
  if (p_source->>'source_checked_at')::timestamptz > now()+interval '5 minutes' or
     (p_source->>'refresh_due_at')::timestamptz <= now() then
    raise exception 'Source is future-dated or expired';
  end if;
  lock table public.neighborhood_boundaries in share mode;
  select case when count(*)=88 and count(distinct boundary_version)=1 then min(boundary_version) end
    into v_boundary from public.neighborhood_boundaries;
  if v_boundary is null or p_source->>'boundary_version' is distinct from v_boundary then
    raise exception 'Supplement boundary edition mismatch';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    f:=r->'facts';
    if f is null or jsonb_typeof(f) is distinct from 'object' then raise exception 'Missing facts'; end if;
    if sid='metro_gtfs' then
      if p_source#>>'{audit,feed_start_date}' is null or p_source#>>'{audit,feed_end_date}' is null then
        raise exception 'Transit feed validity dates required';
      end if;
      foreach k in array array['stop_count','active_route_count','rail_stop_count'] loop
        if jsonb_typeof(f->k) is distinct from 'number' then raise exception 'Missing transit count'; end if;
        n:=(f->>k)::numeric;
        if n<0 or n>20000 or n<>trunc(n) then raise exception 'Invalid transit count'; end if;
      end loop;
      if jsonb_typeof(f->'routes') is distinct from 'array' or
         jsonb_typeof(f->'nearest_stops') is distinct from 'array' or
         jsonb_typeof(f->'service_dates') is distinct from 'array' then raise exception 'Missing transit arrays'; end if;
      if jsonb_array_length(f->'routes')<>(f->>'active_route_count')::integer or jsonb_array_length(f->'routes')>1000 or
         jsonb_array_length(f->'nearest_stops') not between 1 and 5 or jsonb_array_length(f->'service_dates')<>7 or
         (f->>'rail_stop_count')::integer>(f->>'stop_count')::integer then raise exception 'Inconsistent transit facts'; end if;
      if exists(select 1 from jsonb_array_elements_text(f->'service_dates') with ordinality d(value,pos)
        where d.value !~ '^\d{4}-\d{2}-\d{2}$' or d.value::date<>(f#>>'{service_dates,0}')::date+(d.pos-1)::integer) or
        (p_source->>'refresh_due_at')::timestamptz > ((f#>>'{service_dates,6}')::date+1)::timestamp at time zone 'UTC' or
        (p_source->>'refresh_due_at')::timestamptz > (p_source->>'source_checked_at')::timestamptz+interval '8 days' or
        (f#>>'{service_dates,0}')::date < (p_source#>>'{audit,feed_start_date}')::date or
        (f#>>'{service_dates,6}')::date > (p_source#>>'{audit,feed_end_date}')::date then
        raise exception 'Invalid or unsupported transit service window';
      end if;
      if exists(select 1 from jsonb_array_elements(f->'nearest_stops') s where
        jsonb_typeof(s->'straight_line_meters') is distinct from 'number' or (s->>'straight_line_meters')::numeric<0 or
        jsonb_typeof(s->'inside_neighborhood') is distinct from 'boolean' or
        jsonb_typeof(s->'latitude') is distinct from 'number' or (s->>'latitude')::numeric not between 28 and 31.5 or
        jsonb_typeof(s->'longitude') is distinct from 'number' or (s->>'longitude')::numeric not between -97.5 and -94
      ) then raise exception 'Invalid nearest stop'; end if;
    elsif sid='hpd_crime_2024' then
      if f->'year' is distinct from '2024'::jsonb or jsonb_typeof(f->'counts') is distinct from 'object' then raise exception 'Historical year/counts required'; end if;
      if (select count(*) from jsonb_object_keys(f->'counts'))<>5 then raise exception 'Only selected crime counts accepted'; end if;
      foreach k in array array['aggravated_assault','robbery','burglary','motor_vehicle_theft','theft_from_motor_vehicle'] loop
        if not (f->'counts' ? k) then raise exception 'Missing crime field'; end if;
        if f->'counts'->k <> 'null'::jsonb then
          if jsonb_typeof(f->'counts'->k) is distinct from 'number' then raise exception 'Invalid crime count type'; end if;
          n:=(f->'counts'->>k)::numeric;
          if n<0 or n>1000000 or n<>trunc(n) then raise exception 'Invalid crime count'; end if;
        end if;
      end loop;
    else raise exception 'Unsupported source';
    end if;
  end loop;
  insert into public.neighborhood_supplement_sources
    select x.* from jsonb_populate_record(null::public.neighborhood_supplement_sources,p_source) x
    on conflict(source_id) do update set kind=excluded.kind,source_url=excluded.source_url,source_sha256=excluded.source_sha256,
      source_period=excluded.source_period,source_checked_at=excluded.source_checked_at,refresh_due_at=excluded.refresh_due_at,
      boundary_version=excluded.boundary_version,data_version=excluded.data_version,attribution=excluded.attribution,
      limitations=excluded.limitations,audit=excluded.audit;
  insert into public.neighborhood_supplements(source_id,neighborhood_id,facts)
    select sid,(x->>'neighborhood_id')::smallint,x->'facts' from jsonb_array_elements(p_rows) x
    on conflict(source_id,neighborhood_id) do update set facts=excluded.facts;
  return jsonb_build_object('published',88,'source_id',sid,'data_version',p_source->>'data_version');
end;
$$;
revoke all on function public.publish_neighborhood_supplement(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_neighborhood_supplement(jsonb,jsonb) to service_role;

create function public.get_neighborhood_relocation_context(p_neighborhood_id integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare e jsonb; output jsonb; schools jsonb; school_source jsonb; school_count integer;
  s public.neighborhood_supplement_sources; f jsonb; usable boolean; availability text;
  v_boundary text; kind_name text;
begin
  if p_neighborhood_id is null or p_neighborhood_id not between 1 and 88 then
    raise exception 'Neighborhood ID must be 1-88' using errcode='22023';
  end if;
  select boundary_version into v_boundary from public.neighborhood_boundaries where neighborhood_id=p_neighborhood_id;
  e:=public.get_neighborhood_evidence(p_neighborhood_id)#>'{neighborhoods,0,categories,afford}';
  select to_jsonb(ns) into school_source from public.neighborhood_sources ns where source_id='tea_schools_2024_2025';
  -- Source ID is selected by category to accommodate the existing reviewed TEA inventory.
  if school_source is null then
    select to_jsonb(ns) into school_source from public.neighborhood_sources ns where category='schools' order by source_id limit 1;
  end if;
  usable:=school_source is not null and school_source->>'boundary_version'=v_boundary
    and (school_source->>'source_checked_at')::timestamptz<=now()+interval '5 minutes'
    and (school_source->>'source_checked_at')::timestamptz+interval '31 days'>now();
  if usable then
    select count(*) into school_count from public.neighborhood_places p
      where p.source_id=school_source->>'source_id' and p.neighborhood_ids @> array[p_neighborhood_id::smallint];
    select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.place_id),'[]'::jsonb) into schools from (
      select p.place_id,p.name,p.latitude,p.longitude,p.location_method from public.neighborhood_places p
      where p.source_id=school_source->>'source_id' and p.neighborhood_ids @> array[p_neighborhood_id::smallint]
      order by p.name,p.place_id limit 20
    ) x;
  end if;
  output:=jsonb_build_object('schema_version',1,'neighborhood_id',p_neighborhood_id,'evaluated_at',now(),
    'scoring_effect','none','housing',e,
    'schools',jsonb_build_object('availability',case when usable then 'reference_snapshot' when school_source is null then 'unavailable' else 'needs_refresh' end,
      'facts',case when usable then jsonb_build_object('count',school_count,'schools',schools,'returned_count',jsonb_array_length(schools),'truncated',school_count>20) else null end,
      'source',school_source,'refresh_due_at',case when school_source is not null then (school_source->>'source_checked_at')::timestamptz+interval '31 days' else null end,
      'limitations',jsonb_build_array('School-location snapshot, not attendance eligibility, current enrollment, school quality or childcare availability. Verify the specific address with the district.')),
    'safety',jsonb_build_object('tier',null,'availability','unavailable','weighted',false),
    'official_links',jsonb_build_object('crime','https://www.houstontx.gov/police/cs/Monthly_Crime_Data_by_Street_and_Police_Beat.htm',
      'schools','https://tea.texas.gov/families-and-students/school-district-locator',
      'childcare','https://childcare.hhs.texas.gov/Public/ChildCareSearchResults'));
  foreach kind_name in array array['transit','reported_crime'] loop
    select * into s from public.neighborhood_supplement_sources ns where ns.kind=kind_name;
    select facts into f from public.neighborhood_supplements n where n.source_id=s.source_id and n.neighborhood_id=p_neighborhood_id;
    availability:=case when s.source_id is null or f is null then 'unavailable'
      when s.refresh_due_at<=now() or s.source_checked_at>now()+interval '5 minutes' or s.boundary_version is distinct from v_boundary then 'needs_refresh'
      when kind_name='reported_crime' then 'historical_snapshot' else 'scheduled_snapshot' end;
    output:=output||jsonb_build_object(kind_name,jsonb_build_object('availability',availability,
      'facts',case when availability in ('historical_snapshot','scheduled_snapshot') then f else null end,
      'source',case when s.source_id is null then null else to_jsonb(s) end,
      'refresh_due_at',s.refresh_due_at));
  end loop;
  return output;
end;
$$;
revoke all on function public.get_neighborhood_relocation_context(integer) from public;
grant execute on function public.get_neighborhood_relocation_context(integer) to anon,authenticated,service_role;
comment on function public.get_neighborhood_relocation_context(integer) is
 'Optional selected-neighborhood family/transit/historical-crime facts with freshness gates. Does not alter scores or supply crime rates/safety tiers.';
