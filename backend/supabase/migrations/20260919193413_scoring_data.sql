-- Read-only, compact scoring inputs. Reuse the evidence reader's dependency and
-- expiry gates so raw table reads cannot accidentally promote stale facts.
create function public.get_neighborhood_scoring_data()
returns jsonb language sql stable security invoker set search_path='' as $$
  with payload as materialized (
    select public.get_neighborhood_evidence(null) as body
  ), neighborhoods as (
    select n.value as n from payload,
      lateral jsonb_array_elements(payload.body->'neighborhoods') n
  ), categories as (
    select n, c.key as category_id, c.value as evidence,
      case c.key
        when 'afford' then jsonb_build_object(
          'rent_usd',c.value#>'{facts,median_gross_rent_monthly_usd}',
          'home_value_usd',c.value#>'{facts,median_home_value_usd}')
        when 'commute' then jsonb_build_object(
          'ion',d.destinations->'ion','downtown',d.destinations->'downtown',
          'energy',d.destinations->'energy','tmc',d.destinations->'tmc','nasa',d.destinations->'nasa')
        when 'flood' then jsonb_build_object('sfha_area_pct',
          case when c.value#>>'{facts,availability}'='reference_summary'
            then c.value#>'{facts,sfha_area_pct}' else null end)
        when 'amen' then jsonb_build_object(
          'libraries',c.value#>'{facts,inventories,libraries,nearest_to_reference_point,0,straight_line_meters}',
          'museums',c.value#>'{facts,inventories,museums,nearest_to_reference_point,0,straight_line_meters}',
          'community_centers',c.value#>'{facts,inventories,community_centers,nearest_to_reference_point,0,straight_line_meters}',
          'multi_service_centers',c.value#>'{facts,inventories,multi_service_centers,nearest_to_reference_point,0,straight_line_meters}')
        when 'fit' then jsonb_build_object(
          'parks',c.value#>'{facts,inventories,parks,nearest_to_reference_point,0,straight_line_meters}',
          'community_centers',c.value#>'{facts,inventories,community_centers,nearest_to_reference_point,0,straight_line_meters}')
        when 'food' then jsonb_build_object(
          'grocery_stores',c.value#>'{facts,inventories,grocery_stores,nearest_to_reference_point,0,straight_line_meters}')
        when 'air' then jsonb_build_object('iah',d.destinations->'iah','hou',d.destinations->'hou')
        when 'health' then jsonb_build_object(
          'hospitals',c.value#>'{facts,inventories,hospitals,nearest_to_reference_point,0,straight_line_meters}',
          'health_facilities',c.value#>'{facts,inventories,health_facilities,nearest_to_reference_point,0,straight_line_meters}',
          'multi_service_centers',c.value#>'{facts,inventories,multi_service_centers,nearest_to_reference_point,0,straight_line_meters}')
      end as metrics
    from neighborhoods cross join lateral jsonb_each(n->'categories') c
    left join lateral (
      select jsonb_object_agg(a.value->>'id',a.value->'straight_line_meters') as destinations
      from jsonb_array_elements(case when jsonb_typeof(c.value#>'{facts,destinations}')='array'
        then c.value#>'{facts,destinations}' else '[]'::jsonb end) a
    ) d on true
  ), grouped as (
    select (n->>'neighborhood_id')::integer as neighborhood_id,n->'name' as name,n->'reference_point' as reference_point,
      jsonb_object_agg(category_id,jsonb_build_object(
        'availability',evidence->'availability',
        'refresh_due_at',evidence->'refresh_due_at',
        'evidence_version',evidence->'evidence_version',
        'metrics',metrics)) as categories
    from categories group by n
  )
  select jsonb_build_object(
    'schema_version',1,'model_version','houston-proximity-v1',
    'evaluated_at',payload.body->'evaluated_at',
    'category_definitions',payload.body->'category_definitions',
    'neighborhoods',(select jsonb_agg(jsonb_build_object(
      'neighborhood_id',neighborhood_id,'name',name,'reference_point',reference_point,
      'categories',categories) order by neighborhood_id) from grouped)
  ) from payload;
$$;
revoke all on function public.get_neighborhood_scoring_data() from public;
grant execute on function public.get_neighborhood_scoring_data() to anon,authenticated,service_role;
comment on function public.get_neighborhood_scoring_data() is
  'Compact inputs for houston-proximity-v1. Public reference data only; full source context remains in get_neighborhood_evidence. Missing/stale inputs stay null.';
