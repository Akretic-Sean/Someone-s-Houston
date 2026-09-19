begin;
do $$ begin
  assert not has_function_privilege('anon', 'public.reserve_username_signup()', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.reserve_username_signup()', 'EXECUTE');
  assert not has_table_privilege('authenticated', 'report_private.signup_attempts', 'SELECT');
  assert (select relrowsecurity from pg_class where oid = 'report_private.signup_attempts'::regclass);
end $$;
set local role service_role;
do $$ begin
  for i in 1..50 loop assert public.reserve_username_signup() = 'allowed'; end loop;
  assert public.reserve_username_signup() = 'limited';
end $$;
reset role;
update report_private.signup_attempts set created_at = now() - interval '2 hours';
set local role service_role;
do $$ begin assert public.reserve_username_signup() = 'allowed'; end $$;
rollback;
