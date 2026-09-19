begin;
do $$ begin
  assert not has_function_privilege('anon', 'public.reserve_report_ai_request(uuid,uuid)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.reserve_report_ai_request(uuid,uuid)', 'EXECUTE');
  assert not has_schema_privilege('authenticated', 'report_private', 'USAGE');
  assert not has_table_privilege('anon', 'report_private.ai_requests', 'SELECT');
  assert not has_table_privilege('authenticated', 'report_private.ai_requests', 'INSERT');
  assert (select relrowsecurity from pg_class where oid = 'report_private.ai_requests'::regclass);
end $$;
insert into auth.users(id) values ('a9119b57-7235-4bf8-97f9-c28fb7c16328'), ('b9119b57-7235-4bf8-97f9-c28fb7c16328');
set local role service_role;
do $$
declare uid uuid := 'a9119b57-7235-4bf8-97f9-c28fb7c16328'; rid uuid := gen_random_uuid(); i integer;
begin
  assert public.reserve_report_ai_request(uid, rid) = 'allowed';
  assert public.reserve_report_ai_request(uid, rid) = 'duplicate';
  for i in 1..5 loop assert public.reserve_report_ai_request(uid, gen_random_uuid()) = 'allowed'; end loop;
  assert public.reserve_report_ai_request(uid, gen_random_uuid()) = 'limited';
  assert public.reserve_report_ai_request('b9119b57-7235-4bf8-97f9-c28fb7c16328', gen_random_uuid()) = 'allowed';
  insert into report_private.ai_requests(user_id, request_id)
    select uid, gen_random_uuid() from generate_series(1, 93);
  assert public.reserve_report_ai_request('b9119b57-7235-4bf8-97f9-c28fb7c16328', gen_random_uuid()) = 'limited';
end $$;
reset role;
update report_private.ai_requests set created_at = now() - interval '2 hours';
set local role service_role;
do $$ begin
  assert public.reserve_report_ai_request('a9119b57-7235-4bf8-97f9-c28fb7c16328', gen_random_uuid()) = 'allowed';
end $$;
rollback;
