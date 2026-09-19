-- Run against a local migrated Supabase database. Always rolls back.
begin;
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
do $$ begin
 assert not has_table_privilege('anon', 'public.saved_reports', 'select'), 'Anonymous reports must be private';
 assert (select relrowsecurity from pg_class where oid = 'public.saved_reports'::regclass), 'RLS required';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.saved_reports(id,user_id,title,config,snapshot) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Test','{}','{}');
do $$ begin
 assert (select count(*)=1 from public.saved_reports), 'Owner must see saved report';
 begin
  update public.saved_reports set user_id='10000000-0000-0000-0000-000000000002';
  raise exception 'Ownership transfer unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 assert (select count(*)=0 from public.saved_reports), 'Other account must not see report';
 begin
  insert into public.saved_reports(id,user_id,title,config,snapshot) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Forbidden','{}','{}');
  raise exception 'Cross-user insert unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
