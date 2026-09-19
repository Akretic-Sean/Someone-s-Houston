-- Only usage identifiers/timestamps are stored; never notes, profiles or reports.
create schema if not exists report_private;
revoke all on schema report_private from public, anon, authenticated;
grant usage on schema report_private to service_role;

create table report_private.ai_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, request_id)
);
create index ai_requests_created_at on report_private.ai_requests(created_at);
alter table report_private.ai_requests enable row level security;
revoke all on report_private.ai_requests from public, anon, authenticated;
grant select, insert, delete on report_private.ai_requests to service_role;

create or replace function public.reserve_report_ai_request(p_user_id uuid, p_request_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare cutoff timestamptz := clock_timestamp() - interval '1 hour';
begin
  -- The Edge Function authenticates the caller before supplying this user ID.
  -- Browser roles have no EXECUTE grant and cannot reserve or inspect usage.
  if current_user <> 'service_role' or p_user_id is null or p_request_id is null then
    raise exception 'Operator only' using errcode = '42501';
  end if;
  -- One short lock makes both per-user and project-wide limits atomic.
  perform pg_advisory_xact_lock(192609, 100);
  if exists(select 1 from report_private.ai_requests where user_id = p_user_id and request_id = p_request_id) then
    return 'duplicate';
  end if;
  if (select count(*) from report_private.ai_requests where created_at > cutoff) >= 100
    or (select count(*) from report_private.ai_requests where user_id = p_user_id and created_at > cutoff) >= 6 then
    return 'limited';
  end if;
  delete from report_private.ai_requests where created_at < clock_timestamp() - interval '1 day';
  insert into report_private.ai_requests(user_id, request_id) values(p_user_id, p_request_id);
  return 'allowed';
end;
$$;
revoke all on function public.reserve_report_ai_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_report_ai_request(uuid, uuid) to service_role;
