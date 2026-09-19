-- Additive endpoint: existing clients retain the proximity-v1 contract.
-- All sources, boundary dependencies and deadlines inherit the strict evidence gate.
create function public.get_neighborhood_access_scoring_data() returns jsonb
language sql stable security invoker set search_path='' as $$
  with envelope as materialized (
    select public.get_neighborhood_scoring_data_with_estimates() body
  ), rows as (
    select n.value n from envelope, lateral jsonb_array_elements(body#>'{base,neighborhoods}') n
  ), categories as (
    select n, c.key id, c.value category from rows, lateral jsonb_each(n->'categories') c
  ), access as (
    select n, id, category,
      case when id in ('amen','health') then jsonb_build_object(
        'radius_meters',4828.032,
        'facilities',(
          select jsonb_object_agg(k.key,
            case when category->>'availability' in ('partial','reference_snapshot')
              and (category->>'refresh_due_at')::timestamptz>now()
              -- A partial inventory is unknown, never a favorable or fabricated zero.
              and exists(select 1 from public.neighborhood_sources s where s.category=k.key)
              and not exists(select 1 from public.neighborhood_sources s where s.category=k.key
                and (s.published_count<>(select count(*) from public.neighborhood_places p where p.source_id=s.source_id)
                  or not exists(select 1 from public.neighborhood_category_evidence e,
                    lateral jsonb_array_elements(e.dependencies) d
                    where e.neighborhood_id=(n->>'neighborhood_id')::integer and e.category_id=id
                      and d->>'kind'='places' and d->>'source_id'=s.source_id and d->>'version'=s.data_version)))
            then (
              select jsonb_build_object('count',count(*),
                'weighted_count',coalesce(sum(greatest(0.0,1.0-distance/4828.032)),0.0))
              from (
                select extensions.st_distancesphere(
                  extensions.st_makepoint((n#>>'{reference_point,longitude}')::float8,(n#>>'{reference_point,latitude}')::float8),
                  extensions.st_makepoint(p.longitude,p.latitude)) as distance
                from public.neighborhood_places p
                join public.neighborhood_sources s on s.source_id=p.source_id and s.category=p.category
                where p.category=k.key
              ) distances where distance<=4828.032
            ) else null end)
          from jsonb_object_keys(category->'metrics') k(key)
        )
      ) else null end as nearby
    from categories
  ), grouped as (
    select n, jsonb_object_agg(id,case when nearby is null then category
      else category || jsonb_build_object('nearby_access',nearby) end) cats
    from access group by n
  )
  select jsonb_set(body,'{base}',
    (body->'base') || jsonb_build_object('model_version','houston-access-v2','neighborhoods',
      (select jsonb_agg(n || jsonb_build_object('categories',cats) order by (n->>'neighborhood_id')::integer) from grouped)))
  from envelope;
$$;
revoke all on function public.get_neighborhood_access_scoring_data() from public;
grant execute on function public.get_neighborhood_access_scoring_data() to anon,authenticated,service_role;
comment on function public.get_neighborhood_access_scoring_data() is
  'Source-bounded scoring envelope for houston-access-v2. Amenities/health use full imported inventory within 3 miles of reference point, spherical straight-line distance, sum(1-distance/radius). Counts are source records per type, not unique sites across types. Original endpoints unchanged.';
