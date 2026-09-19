create table public.neighborhood_gap_inputs (
  neighborhood_id integer primary key references public.neighborhood_profiles(neighborhood_id),
  category_id text not null, metric text not null,
  lower_bound numeric not null, upper_bound numeric not null, ranking_value numeric not null,
  method text not null check(method='conservative_upper_bound'),
  source_url text not null, source_period text not null check(length(source_period) between 1 and 300),
  source_checked_at timestamptz not null, refresh_due_at timestamptz not null,
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  boundary_version text not null, base_evidence_version text not null,
  audit jsonb not null check(jsonb_typeof(audit)='object' and pg_column_size(audit)<100000),
  limitation text not null check(length(limitation) between 1 and 2000),
  check(lower_bound>=0 and upper_bound>=lower_bound and ranking_value=upper_bound),
  check(refresh_due_at>source_checked_at and refresh_due_at<=source_checked_at+interval '31 days'),
  check((neighborhood_id=7 and category_id='afford' and metric='rent_usd' and lower_bound=1500 and upper_bound=1999
    and source_url='https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf') or
    (neighborhood_id in (17,25,41,43,80) and category_id='flood' and metric='sfha_area_pct' and upper_bound<=100
    and upper_bound-lower_bound<=5 and source_url='https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28'))
);
alter table public.neighborhood_gap_inputs enable row level security;
revoke all on public.neighborhood_gap_inputs from anon,authenticated;
grant select on public.neighborhood_gap_inputs to anon,authenticated;
grant all on public.neighborhood_gap_inputs to service_role;
create policy "Public reference input reads" on public.neighborhood_gap_inputs for select to anon,authenticated using(true);

create function public.publish_neighborhood_gap_inputs(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>6 or pg_column_size(p_rows)>300000 then
    raise exception 'Expected six bounded ranking inputs';
  end if;
  lock table public.neighborhood_category_evidence in share mode;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    left join public.neighborhood_category_evidence e on e.neighborhood_id=(r->>'neighborhood_id')::integer and e.category_id=r->>'category_id'
    where e.neighborhood_id is null or e.boundary_version<>r->>'boundary_version' or e.refresh_due_at<=now()
      or (r->>'source_checked_at')::timestamptz>now()+interval '5 minutes' or (r->>'refresh_due_at')::timestamptz<=now()) then
    raise exception 'Missing, mismatched or expired source dependencies';
  end if;
  -- Atomic replacement: constraints reject unexpected/duplicate IDs and preserve the previous edition on failure.
  delete from public.neighborhood_gap_inputs;
  insert into public.neighborhood_gap_inputs
  select r.neighborhood_id,r.category_id,r.metric,r.lower_bound,r.upper_bound,r.ranking_value,r.method,
    r.source_url,r.source_period,r.source_checked_at,r.refresh_due_at,r.source_sha256,r.boundary_version,
    e.evidence_version,r.audit,r.limitation
  from jsonb_populate_recordset(null::public.neighborhood_gap_inputs,p_rows) r
  join public.neighborhood_category_evidence e on e.neighborhood_id=r.neighborhood_id and e.category_id=r.category_id;
  get diagnostics n=row_count;
  if n<>6 then raise exception 'Incomplete gap publication'; end if;
  return jsonb_build_object('published',n);
end;
$$;
revoke all on function public.publish_neighborhood_gap_inputs(jsonb) from public,anon,authenticated;
grant execute on function public.publish_neighborhood_gap_inputs(jsonb) to service_role;

create function public.get_neighborhood_scoring_data_with_estimates() returns jsonb
language sql stable security invoker set search_path='' as $$
  with base as materialized (select public.get_neighborhood_scoring_data() body),
  active as (
    select to_jsonb(g) as item from public.neighborhood_gap_inputs g
    join public.neighborhood_category_evidence e on e.neighborhood_id=g.neighborhood_id and e.category_id=g.category_id
    join public.neighborhood_boundaries b on b.neighborhood_id=g.neighborhood_id
    where g.base_evidence_version=e.evidence_version and g.boundary_version=e.boundary_version
      and g.boundary_version=b.boundary_version
      and g.refresh_due_at>now() and g.source_checked_at<=now()+interval '5 minutes'
      and e.refresh_due_at>now()
  )
  select jsonb_build_object('schema_version',1,'policy_version','source-bounded-v1','base',base.body,
    'estimates',coalesce((select jsonb_agg(item order by (item->>'neighborhood_id')::integer) from active),'[]'::jsonb)) from base;
$$;
revoke all on function public.get_neighborhood_scoring_data_with_estimates() from public;
grant execute on function public.get_neighborhood_scoring_data_with_estimates() to anon,authenticated,service_role;
