-- Signup attempts contain timestamps only, never usernames or passwords.
create table report_private.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp()
);
create index signup_attempts_created_at on report_private.signup_attempts(created_at);
alter table report_private.signup_attempts enable row level security;
revoke all on report_private.signup_attempts from public, anon, authenticated;
grant select, insert, delete on report_private.signup_attempts to service_role;
create function public.reserve_username_signup()
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operator only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(192609, 101);
  if (select count(*) from report_private.signup_attempts where created_at > clock_timestamp() - interval '1 hour') >= 50 then
    return 'limited';
  end if;
  delete from report_private.signup_attempts where created_at < clock_timestamp() - interval '1 day';
  insert into report_private.signup_attempts default values;
  return 'allowed';
end;
$$;
revoke all on function public.reserve_username_signup() from public, anon, authenticated;
grant execute on function public.reserve_username_signup() to service_role;
