"""Run every SQL contract test in a disposable local Supabase database.

Requires Docker, Node and Python. Never accepts a remote database URL or uses
project credentials. No source downloads, hosted writes or refresh HTTP calls.
"""
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import tempfile
import uuid

BACKEND = Path(__file__).resolve().parents[1]


def run_cli(args, timeout):
    # npx.cmd creates children on Windows. Kill the complete owned process tree
    # on timeout, before cleanup, so a late image pull cannot start an orphan DB.
    process = subprocess.Popen(args, start_new_session=os.name != "nt")
    try:
        code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, timeout=30)
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=30)
        raise
    if code:
        raise subprocess.CalledProcessError(code, args)


def literal(value):
    return "'" + json.dumps(value, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def fixture_sql():
    data = BACKEND / "data"
    profiles = json.loads((data / "super-neighborhoods.json").read_text())
    boundaries = json.loads((data / "super-neighborhood-boundaries.geojson").read_text())
    manifest = json.loads((data / "super-neighborhood-boundaries.manifest.json").read_text())
    sources = json.loads((data / "neighborhood-amenities.json").read_text())["sources"]
    for source in sources:
        source.update(boundary_version=manifest["boundary_version"], published_count=0,
                      data_version="test-facilities", geometry_repair_count=0)
    # Real committed profiles/boundaries; synthetic inventory/evidence isolates
    # SQL behavior from vendor uptime and the current calendar date.
    return f"""
insert into public.neighborhood_profiles
select * from jsonb_populate_recordset(null::public.neighborhood_profiles,{literal(profiles)});
insert into public.neighborhood_boundaries
select (f->>'id')::smallint,extensions.st_multi(extensions.st_geomfromgeojson(f->'geometry')),
       f->'properties'->>'boundary_version',now(),null
from jsonb_array_elements({literal(boundaries['features'])}) f;
insert into public.neighborhood_sources
select * from jsonb_populate_recordset(null::public.neighborhood_sources,{literal(sources)});
insert into public.live_context
select id,'https://example.test/fixture',now()-interval '5 minutes',now()-interval '5 minutes',
       now()+interval '25 minutes','{{"type":"FeatureCollection","features":[]}}',0,'Test fixture','Test only'
from unnest(array['nws_alerts','usgs_gauges']) id;
insert into public.neighborhood_category_evidence
select p.neighborhood_id,c.category_id,'partial',
       jsonb_build_object('median_gross_rent_monthly_usd',p.median_gross_rent),
       jsonb_build_array(jsonb_build_object('source_id','fixture','source_url','https://example.test/fixture',
                                          'source_checked_at',now(),'source_period',null)),
       array['Synthetic test fixture'],array['Not published data'],
       jsonb_build_array(jsonb_build_object('kind','profile','version',p.data_version)) ||
       case when c.category_id='fit' then jsonb_build_array(jsonb_build_object('kind','places',
         'source_id','coh_parks','version','test-facilities')) else '[]'::jsonb end,
       b.boundary_version,'report-evidence-0000000000000000',now(),now()+interval '90 days'
from public.neighborhood_profiles p cross join public.report_category_config c
join public.neighborhood_boundaries b on b.neighborhood_id=p.neighborhood_id;
"""


def main():
    project = "hou-match-test-" + uuid.uuid4().hex[:12]
    npx = "npx.cmd" if os.name == "nt" else "npx"
    with tempfile.TemporaryDirectory(prefix=project + "-") as directory:
        root = Path(directory)
        (root / "supabase").mkdir()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        (root / "supabase/config.toml").write_text(
            f'project_id = "{project}"\n[db]\nport = {port}\nmajor_version = 17\n'
            '[db.seed]\nenabled = false\n', encoding="utf-8")
        cli = [npx, "--yes", "supabase@2.117.0", "--workdir", directory]

        def sql(contents):
            subprocess.run(["docker", "exec", "-i", "supabase_db_" + project,
                            "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
                           input=contents, text=True, encoding="utf-8", check=True, timeout=180)

        try:
            run_cli(cli + ["db", "start"], timeout=600)
            migrations = sorted((BACKEND / "supabase/migrations").glob("*.sql"))
            # Cron cannot see the scheduled job until commit. Disable it inside
            # that same transaction: tests must never call the hosted function.
            sql("begin;\n" + "\n".join(p.read_text(encoding="utf-8") for p in migrations) +
                "\nupdate cron.job set active=false where jobname='hou-match-current-context';\ncommit;")
            sql(fixture_sql())
            tests = sorted((BACKEND / "supabase/tests").glob("*.sql"))
            if not tests:
                raise RuntimeError("No SQL tests found")
            for test in tests:
                print(f"Running {test.name}", flush=True)
                sql(test.read_text(encoding="utf-8"))
            sql("""do $$ begin
                assert not exists(select 1 from cron.job where active), 'Test Cron must remain disabled';
                assert not exists(select 1 from net.http_request_queue), 'Tests must not queue HTTP requests';
                assert not exists(select 1 from net._http_response), 'Tests must not send HTTP requests';
                end $$;""")
            print(f"Passed {len(tests)} SQL suites against all {len(migrations)} migrations.")
        finally:
            # Only this randomly named test project; never stop another checkout.
            run_cli(cli + ["stop", "--project-id", project, "--no-backup"], timeout=120)


if __name__ == "__main__":
    main()
