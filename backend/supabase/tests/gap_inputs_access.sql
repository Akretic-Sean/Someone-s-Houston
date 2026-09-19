begin;
do $$
declare rows jsonb; original jsonb; failed boolean:=false;
begin
  original:=public.get_neighborhood_scoring_data();
  select jsonb_agg(jsonb_build_object('neighborhood_id',n,'category_id',case when n=7 then 'afford' else 'flood' end,
    'metric',case when n=7 then 'rent_usd' else 'sfha_area_pct' end,
    'lower_bound',case when n=7 then 1500 else 10 end,'upper_bound',case when n=7 then 1999 else 11 end,
    'ranking_value',case when n=7 then 1999 else 11 end,'method','conservative_upper_bound',
    'source_url',case when n=7 then 'https://www.houstontx.gov/planning/Demographics/sn-demographics-2024/6-Gross-Rent-2024.pdf'
      else 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28' end,
    'source_period','fixture','source_checked_at',now(),'refresh_due_at',now()+interval '1 day',
    'source_sha256',repeat('a',64),'boundary_version',b.boundary_version,'audit','{}'::jsonb,'limitation','Test only'))
    into rows from unnest(array[7,17,25,41,43,80]) n join public.neighborhood_boundaries b on b.neighborhood_id=n;
  perform public.publish_neighborhood_gap_inputs(rows);
  assert (select count(*) from public.neighborhood_gap_inputs)=6;
  assert jsonb_array_length(public.get_neighborhood_scoring_data_with_estimates()->'estimates')=6;
  assert public.get_neighborhood_scoring_data()=original,'Original scoring data changed';
  begin perform public.publish_neighborhood_gap_inputs(rows-0); exception when others then failed:=true; end;
  assert failed; failed:=false;
  begin perform public.publish_neighborhood_gap_inputs(jsonb_set(rows,'{0,ranking_value}','0')); exception when others then failed:=true; end;
  assert failed;
  assert (select count(*) from public.neighborhood_gap_inputs)=6,'Malformed publication lost previous rows';
  update public.neighborhood_gap_inputs set refresh_due_at=now()-interval '1 second',source_checked_at=now()-interval '2 days' where neighborhood_id=7;
  assert jsonb_array_length(public.get_neighborhood_scoring_data_with_estimates()->'estimates')=5;
  update public.neighborhood_gap_inputs set base_evidence_version='old' where neighborhood_id=17;
  assert jsonb_array_length(public.get_neighborhood_scoring_data_with_estimates()->'estimates')=4;
end;
$$;
set local role anon;
do $$ begin
  assert not has_table_privilege('anon','public.neighborhood_gap_inputs','INSERT');
  assert not has_function_privilege('anon','public.publish_neighborhood_gap_inputs(jsonb)','EXECUTE');
  assert public.get_neighborhood_scoring_data_with_estimates()->>'policy_version'='source-bounded-v1';
end; $$;
reset role;
set local role authenticated;
do $$ begin
  assert not has_table_privilege('authenticated','public.neighborhood_gap_inputs','UPDATE');
  assert not has_function_privilege('authenticated','public.publish_neighborhood_gap_inputs(jsonb)','EXECUTE');
  assert public.get_neighborhood_scoring_data_with_estimates()->>'policy_version'='source-bounded-v1';
end; $$;
rollback;
