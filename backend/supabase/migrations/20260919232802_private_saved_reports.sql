-- Private report history; public evidence remains in its existing tables.
create table public.saved_reports (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (length(title) between 1 and 200),
 config jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 50000),
 snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 5000000),
 created_at timestamptz not null default now()
);
create index saved_reports_owner_created on public.saved_reports(user_id, created_at desc);
alter table public.saved_reports enable row level security;
revoke all on public.saved_reports from anon, authenticated;
grant select, insert, update on public.saved_reports to authenticated;
create policy saved_reports_read on public.saved_reports for select to authenticated using ((select auth.uid()) = user_id);
create policy saved_reports_insert on public.saved_reports for insert to authenticated with check ((select auth.uid()) = user_id);
create policy saved_reports_update on public.saved_reports for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
