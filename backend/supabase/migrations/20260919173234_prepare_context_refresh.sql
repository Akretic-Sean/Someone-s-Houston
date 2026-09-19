create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- A project-specific 256-bit token stays in Vault. Only its SHA-256 is deployed.
do $$
begin
  if not exists(select 1 from vault.secrets where name='hou_match_context_refresh_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'hou_match_context_refresh_token','Authentication for Hou Match fixed-purpose current-context refresh');
  end if;
end;
$$;

create function hou_match_private.request_context_refresh()
returns bigint language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name='hou_match_context_refresh_token';
  if token is null then raise exception 'Context refresh token is not configured'; end if;
  -- Retention applies only to our ingestion scratch data and our own cron history.
  delete from hou_match_private.geo_import_features where created_at<now()-interval '1 day';
  delete from cron.job_run_details where jobid in(select jobid from cron.job where jobname='hou-match-current-context') and end_time<now()-interval '7 days';
  select net.http_post(
    url:='https://hknzivrgihnqzvsafkkr.supabase.co/functions/v1/refresh-neighborhood-context',
    headers:=jsonb_build_object('Content-Type','application/json','x-refresh-token',token),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function hou_match_private.request_context_refresh() from public, anon, authenticated, service_role;
