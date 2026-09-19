-- Run against a seeded database via SQL Editor or execute_sql. Always rolls back.
begin;
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.neighborhood_profiles'::regclass), 'RLS must be enabled';
  assert not has_table_privilege('anon', 'public.neighborhood_profiles', 'truncate'), 'Anonymous truncate must be denied';
  assert not has_table_privilege('authenticated', 'public.neighborhood_profiles', 'truncate'), 'Authenticated truncate must be denied';
end;
$$;

set local role anon;
do $$
begin
  assert (select count(*) = 88 from public.neighborhood_profiles), 'Anonymous reads must return 88 rows';
  begin
    insert into public.neighborhood_profiles(neighborhood_id) values (89);
    raise exception 'Anonymous insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.neighborhood_profiles set name = name where neighborhood_id = 1;
    raise exception 'Anonymous update unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.neighborhood_profiles where neighborhood_id = 1;
    raise exception 'Anonymous delete unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  assert (select count(*) = 88 from public.neighborhood_profiles), 'Authenticated reads must return 88 rows';
  begin
    insert into public.neighborhood_profiles(neighborhood_id) values (89);
    raise exception 'Authenticated insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.neighborhood_profiles set name = name where neighborhood_id = 1;
    raise exception 'Authenticated update unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.neighborhood_profiles where neighborhood_id = 1;
    raise exception 'Authenticated delete unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
