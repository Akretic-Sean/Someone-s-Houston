-- Public reference data only. Candidate/report data belongs in separately protected tables.
create table public.neighborhood_profiles (
  neighborhood_id smallint primary key check (neighborhood_id between 1 and 88),
  name text not null check (length(name) between 1 and 120),
  median_household_income integer check (median_household_income > 0),
  median_home_value integer check (median_home_value > 0),
  median_gross_rent integer check (median_gross_rent > 0),
  centroid_lat double precision not null check (centroid_lat between 29 and 31),
  centroid_lon double precision not null check (centroid_lon between -96.5 and -94.5),
  source_period_start smallint not null check (source_period_start between 2000 and 2100),
  source_period_end smallint not null check (source_period_end = source_period_start + 4),
  data_version text not null check (data_version ~ '^coh-sn-[0-9]{4}-[a-f0-9]{16}$'),
  source_url text not null check (source_url = 'https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/Super_Neighborhoods_Demographics/FeatureServer/2'),
  source_retrieved_at timestamptz not null,
  quality_flags text[] not null default '{}',
  constraint known_quality_flags check (quality_flags <@ array['income_unavailable', 'home_value_unavailable', 'rent_unavailable']::text[]),
  constraint income_missing_flag check ((median_household_income is null) = ('income_unavailable' = any(quality_flags))),
  constraint home_missing_flag check ((median_home_value is null) = ('home_value_unavailable' = any(quality_flags))),
  constraint rent_missing_flag check ((median_gross_rent is null) = ('rent_unavailable' = any(quality_flags)))
);

comment on table public.neighborhood_profiles is '88 City of Houston Super Neighborhood profiles. Current validated ACS release only; estimates are not listings. Source period is separate from retrieval time.';
comment on column public.neighborhood_profiles.median_household_income is 'Annual household income in USD, not individual salary.';
comment on column public.neighborhood_profiles.median_home_value is 'City-published estimated median housing value in USD; not asking price.';
comment on column public.neighborhood_profiles.median_gross_rent is 'Estimated monthly gross rent in USD. NULL means unavailable, never zero.';
comment on column public.neighborhood_profiles.centroid_lat is 'ArcGIS polygon centroid in WGS84. Use for map markers/straight-line distance only; not an address or travel time.';

alter table public.neighborhood_profiles enable row level security;
revoke all on public.neighborhood_profiles from public, anon, authenticated, service_role;
grant select on public.neighborhood_profiles to anon, authenticated;
grant select, insert, update on public.neighborhood_profiles to service_role;
create policy "Public neighborhood reference reads"
  on public.neighborhood_profiles for select to anon, authenticated using (true);

-- No extra indexes for an 88-row full-table read; the primary key handles ID lookup/upsert.
-- Do not add this annual reference table to the Realtime publication.
