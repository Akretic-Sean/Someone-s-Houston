-- Supabase's existing auto-RLS event trigger is administrative, not an app RPC.
-- Some local/new environments do not have this helper; leave those unchanged.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
