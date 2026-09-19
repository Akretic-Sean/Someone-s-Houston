-- Compact, precomputed public evidence; no candidate data and no invented scores.
create table public.report_category_config (
  category_id text primary key check (category_id in ('afford','commute','flood','amen','fit','food','air','health')),
  label text not null,
  default_weight smallint not null check (default_weight between 0 and 10),
  display_order smallint not null unique check (display_order between 1 and 8),
  profile_id text not null check (profile_id = 'report-priorities-v1')
);
insert into public.report_category_config values
 ('afford','Affordability',8,1,'report-priorities-v1'),
 ('commute','Commute',7,2,'report-priorities-v1'),
 ('flood','Flood context',6,3,'report-priorities-v1'),
 ('amen','Local amenities',5,4,'report-priorities-v1'),
 ('fit','Fitness and recreation',7,5,'report-priorities-v1'),
 ('food','Dining and grocery access',8,6,'report-priorities-v1'),
 ('air','Airport access',6,7,'report-priorities-v1'),
 ('health','Healthcare access',7,8,'report-priorities-v1');

create function public.evidence_sources_valid(p_sources jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare s jsonb;
begin
  if jsonb_typeof(p_sources) is distinct from 'array' then return false; end if;
  for s in select value from jsonb_array_elements(p_sources) loop
    if jsonb_typeof(s) is distinct from 'object' or
       jsonb_typeof(s->'source_id') is distinct from 'string' or coalesce(length(s->>'source_id'),0)=0 or
       coalesce(s->>'source_url','') !~ '^https://[^/[:space:]]+(/|$)' or
       jsonb_typeof(s->'source_checked_at') is distinct from 'string' or
       not (s ? 'source_period') or jsonb_typeof(s->'source_period') not in ('null','string') then return false; end if;
    if (s->>'source_checked_at')::timestamptz is null then return false; end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.evidence_sources_valid(jsonb) from public,anon,authenticated;
grant execute on function public.evidence_sources_valid(jsonb) to service_role;

create table public.neighborhood_category_evidence (
  neighborhood_id smallint not null references public.neighborhood_profiles(neighborhood_id),
  category_id text not null references public.report_category_config(category_id),
  availability text not null check (availability in ('reference_snapshot','partial','unavailable')),
  facts jsonb not null check (jsonb_typeof(facts)='object' and octet_length(facts::text)<40000),
  sources jsonb not null check (public.evidence_sources_valid(sources) and jsonb_array_length(sources)<=20),
  missing_inputs text[] not null,
  limitations text[] not null,
  dependencies jsonb not null check (jsonb_typeof(dependencies)='array' and jsonb_array_length(dependencies)<=12),
  boundary_version text not null,
  evidence_version text not null check (evidence_version ~ '^report-evidence-[a-f0-9]{16}$'),
  prepared_at timestamptz not null,
  refresh_due_at timestamptz not null check (refresh_due_at>prepared_at),
  primary key(neighborhood_id,category_id),
  check (availability='unavailable' or (jsonb_array_length(sources)>0 and facts<>'{}'::jsonb)),
  check (octet_length(sources::text)<40000)
);
create index neighborhood_category_evidence_category_idx on public.neighborhood_category_evidence(category_id);

alter table public.report_category_config enable row level security;
alter table public.neighborhood_category_evidence enable row level security;
revoke all on public.report_category_config,public.neighborhood_category_evidence from public,anon,authenticated,service_role;
grant select on public.report_category_config,public.neighborhood_category_evidence to anon,authenticated;
grant select,insert,update,delete on public.report_category_config,public.neighborhood_category_evidence to service_role;
create policy "Public report category reads" on public.report_category_config for select to anon,authenticated using(true);
create policy "Public category evidence reads" on public.neighborhood_category_evidence for select to anon,authenticated using(true);

-- Reuse the existing private, bounded staging API. All 704 records publish together.
create function public.publish_neighborhood_evidence(p_batch text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare total integer; versions integer; v text;
begin
  lock table hou_match_private.geo_import_features in share row exclusive mode;
  select count(*),count(distinct feature->>'evidence_version'),min(feature->>'evidence_version')
    into total,versions,v from hou_match_private.geo_import_features where batch_id=p_batch;
  if total<>704 or versions<>1 or v is null then raise exception 'Exactly 88 x 8 records of one version required'; end if;
  if exists(select 1 from hou_match_private.geo_import_features f
    where batch_id=p_batch and (
      f.feature_id <> 'evidence:'||(f.feature->>'neighborhood_id')||':'||(f.feature->>'category_id')
      or not exists(select 1 from public.neighborhood_boundaries b
        where b.neighborhood_id=(f.feature->>'neighborhood_id')::integer and b.boundary_version=f.feature->>'boundary_version')
      or (f.feature->>'prepared_at')::timestamptz>now()+interval '5 minutes'
      or (f.feature->>'refresh_due_at')::timestamptz<=now()
    )) then raise exception 'Evidence identity, boundary or freshness mismatch'; end if;
  insert into public.neighborhood_category_evidence
    select r.* from hou_match_private.geo_import_features f
    cross join lateral jsonb_populate_record(null::public.neighborhood_category_evidence,f.feature) r
    where f.batch_id=p_batch
  on conflict(neighborhood_id,category_id) do update set
    availability=excluded.availability,facts=excluded.facts,sources=excluded.sources,
    missing_inputs=excluded.missing_inputs,limitations=excluded.limitations,dependencies=excluded.dependencies,
    boundary_version=excluded.boundary_version,evidence_version=excluded.evidence_version,
    prepared_at=excluded.prepared_at,refresh_due_at=excluded.refresh_due_at;
  get diagnostics total=row_count;
  if total<>704 then raise exception 'Incomplete evidence publication'; end if;
  delete from hou_match_private.geo_import_features where batch_id=p_batch;
  return jsonb_build_object('published',704,'evidence_version',v);
end;
$$;
revoke all on function public.publish_neighborhood_evidence(text) from public,anon,authenticated;
grant execute on function public.publish_neighborhood_evidence(text) to service_role;

create function public.get_neighborhood_evidence(p_neighborhood_id integer default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_neighborhood_id is not null and p_neighborhood_id not between 1 and 88 then
    raise exception 'Neighborhood ID must be 1-88' using errcode='22023';
  end if;
  with evidence as (
    select p.neighborhood_id,p.name,p.centroid_lat,p.centroid_lon,c.category_id,c.display_order,
      e.facts,e.sources,e.missing_inputs,e.limitations,e.evidence_version,e.prepared_at,e.refresh_due_at,
      case when e.neighborhood_id is null then 'unavailable'
           when e.boundary_version is distinct from b.boundary_version then 'needs_refresh'
           when e.refresh_due_at<=now() then 'needs_refresh'
           when exists(select 1 from jsonb_array_elements(e.dependencies) d
             where case d->>'kind'
               when 'profile' then d->>'version' is distinct from p.data_version
               when 'places' then not exists(select 1 from public.neighborhood_sources s
                  where s.source_id=d->>'source_id' and s.data_version=d->>'version' and s.boundary_version=b.boundary_version)
               else true end) then 'needs_refresh'
           else e.availability end as read_availability
    from public.neighborhood_profiles p
    cross join public.report_category_config c
    left join public.neighborhood_boundaries b on b.neighborhood_id=p.neighborhood_id
    left join public.neighborhood_category_evidence e on e.neighborhood_id=p.neighborhood_id and e.category_id=c.category_id
    where p_neighborhood_id is null or p.neighborhood_id=p_neighborhood_id
  ), grouped as (
    select evidence.neighborhood_id,evidence.name,evidence.centroid_lat,evidence.centroid_lon,
      jsonb_object_agg(evidence.category_id,jsonb_build_object(
        'availability',read_availability,
        'facts',case when read_availability in ('reference_snapshot','partial') then facts else null end,
        'sources',coalesce(sources,'[]'::jsonb),
        'missing_inputs',coalesce(to_jsonb(missing_inputs),'["Evidence has not been imported."]'::jsonb),
        'limitations',coalesce(to_jsonb(limitations),'[]'::jsonb),
        'evidence_version',evidence_version,'prepared_at',prepared_at,'refresh_due_at',refresh_due_at,
        'score',null,'score_status','not_implemented')) as categories
    from evidence group by evidence.neighborhood_id,evidence.name,evidence.centroid_lat,evidence.centroid_lon
  ) select jsonb_build_object(
    'profile_id','report-priorities-v1','weight_total',54,'evaluated_at',now(),
    'category_definitions',(select jsonb_agg(jsonb_build_object('id',category_id,'label',label,'default_weight',default_weight) order by display_order) from public.report_category_config),
    'safety',jsonb_build_object('weighted',false,'tier',null,'availability','unavailable','reason','No validated safety dataset or tier methodology is implemented.'),
    'neighborhoods',coalesce((select jsonb_agg(jsonb_build_object('neighborhood_id',neighborhood_id,'name',name,
      'reference_point',jsonb_build_object('latitude',centroid_lat,'longitude',centroid_lon,'method','source_polygon_center'),
      'categories',categories) order by neighborhood_id) from grouped),'[]'::jsonb),
    'interpretation','Source-backed reference evidence, not a completed score or a current property listing. Missing and stale facts are unknown. Distances, when present, are straight-line from a neighborhood reference point, never drive or walking times.'
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_neighborhood_evidence(integer) from public;
grant execute on function public.get_neighborhood_evidence(integer) to anon,authenticated,service_role;
