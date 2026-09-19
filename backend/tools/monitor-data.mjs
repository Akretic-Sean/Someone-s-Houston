import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createContextClient } from '../dist/context.js';
import { readBoundedJson, supabaseBaseUrl } from '../dist/neighborhoods.js';

export const CATEGORIES = ['afford', 'commute', 'flood', 'amen', 'fit', 'food', 'air', 'health'];
export const MARKER = '<!-- hou-match-data-monitor:v1 -->';
const DAY = 86_400_000;
const id = z.number().int().min(1).max(88);
const version = z.string().min(1).max(200);
const time = z.iso.datetime({ offset: true });
const evidenceSchema = z.array(z.object({
  neighborhood_id: id, category_id: z.enum(CATEGORIES), refresh_due_at: time, prepared_at: time,
  boundary_version: version,
  dependencies: z.array(z.union([
    z.object({ kind: z.literal('profile'), version }),
    z.object({ kind: z.literal('places'), source_id: version, version }),
  ])).max(12),
})).length(704);
const profilesSchema = z.array(z.object({ neighborhood_id: id, data_version: version })).length(88);
const boundariesSchema = z.array(z.object({ neighborhood_id: id, boundary_version: version })).length(88);
const sourcesSchema = z.array(z.object({ source_id: version, data_version: version, boundary_version: version })).length(8);

export function referenceProblems(snapshot, now = Date.now()) {
  const evidence = evidenceSchema.parse(snapshot.evidence);
  const profiles = profilesSchema.parse(snapshot.profiles);
  const boundaries = boundariesSchema.parse(snapshot.boundaries);
  const sources = sourcesSchema.parse(snapshot.sources);
  if (new Set(evidence.map(r => `${r.neighborhood_id}:${r.category_id}`)).size !== 704 ||
      new Set(profiles.map(r => r.neighborhood_id)).size !== 88 ||
      new Set(boundaries.map(r => r.neighborhood_id)).size !== 88 ||
      new Set(boundaries.map(r => r.boundary_version)).size !== 1 ||
      new Set(sources.map(r => r.source_id)).size !== 8) throw new Error('Incomplete or mixed reference publication');
  const p = new Map(profiles.map(r => [r.neighborhood_id, r.data_version]));
  const b = new Map(boundaries.map(r => [r.neighborhood_id, r.boundary_version]));
  const s = new Map(sources.map(r => [r.source_id, r]));
  const problems = [];
  if (sources.some(r => r.boundary_version !== boundaries[0].boundary_version)) {
    problems.push({ code: 'facilities:boundary', severity: 'critical', message: 'Facility membership uses an obsolete boundary edition. Rejoin and republish facilities, then evidence.' });
  }
  for (const category of CATEGORIES) {
    const rows = evidence.filter(r => r.category_id === category);
    if (rows.some(r => Date.parse(r.prepared_at) > now + 300_000 || Date.parse(r.refresh_due_at) <= Date.parse(r.prepared_at))) {
      throw new Error('Invalid evidence freshness interval');
    }
    const drift = rows.filter(r => r.boundary_version !== b.get(r.neighborhood_id) || r.dependencies.some(d =>
      d.kind === 'profile' ? d.version !== p.get(r.neighborhood_id) :
        s.get(d.source_id)?.data_version !== d.version || s.get(d.source_id)?.boundary_version !== r.boundary_version));
    if (drift.length) problems.push({ code: `${category}:dependency`, severity: 'critical', message: `${category}: ${drift.length} neighborhoods have outdated evidence dependencies. Rebuild and publish evidence.` });
    const earliest = Math.min(...rows.map(r => Date.parse(r.refresh_due_at)));
    if (earliest <= now + 14 * DAY) problems.push({ code: `${category}:expiry`, severity: earliest <= now ? 'critical' : 'warning',
      message: `${category}: earliest evidence expiry ${new Date(earliest).toISOString()}. ${earliest <= now ? 'Expired facts are withheld by the API.' : 'Refresh before this deadline.'}` });
  }
  return problems;
}

export function supplementProblems({ sources, rows, boundaries }, now = Date.now()) {
  const ids = ['metro_gtfs', 'hpd_crime_2024'];
  const manifests = z.array(z.object({ source_id: z.enum(ids), source_checked_at: time, refresh_due_at: time, boundary_version: version })).length(2).parse(sources);
  const records = z.array(z.object({ source_id: z.enum(ids), neighborhood_id: id })).length(176).parse(rows);
  if (new Set(manifests.map(s => s.source_id)).size !== 2 || new Set(records.map(r => `${r.source_id}:${r.neighborhood_id}`)).size !== 176 ||
      !Array.isArray(boundaries) || boundaries.length !== 88 || new Set(boundaries.map(b => b.boundary_version)).size !== 1) throw new Error('Incomplete context cohort');
  const problems = [];
  for (const source of manifests) {
    const expiry = Date.parse(source.refresh_due_at), checked = Date.parse(source.source_checked_at);
    if (checked > now + 300000 || expiry <= checked || source.boundary_version !== boundaries[0].boundary_version) {
      problems.push({ code: `supplement:${source.source_id}:invalid`, severity: 'critical', message: `${source.source_id}: invalid validity or changed boundary edition. Re-prepare the optional context.` });
    } else if (expiry <= now + (source.source_id === 'metro_gtfs' ? 2 : 7) * DAY) {
      problems.push({ code: `supplement:${source.source_id}:expiry`, severity: expiry <= now ? 'critical' : 'warning',
        message: `${source.source_id}: refresh due ${source.refresh_due_at}. Refresh the optional context; expired facts are withheld.` });
    }
  }
  return problems;
}

export async function checkHealth({ url, publishableKey, fetch: fetcher = fetch, now = Date.now() }) {
  const problems = [];
  let checkedBoundaries;
  // Independent probes: an outage in one layer must not hide the other.
  try {
    const client = createContextClient({ url, publishableKey, fetch: fetcher, currentCacheMs: 0, now: () => now });
    const context = await client.getCurrentConditions({ limit: 1 });
    for (const feed of context.feeds) if (feed.availability !== 'current') {
      problems.push({ code: `live:${feed.source_id}`, severity: 'critical', message: `${feed.source_id}: ${feed.availability}. Inspect the refresh function's response and upstream source.` });
    }
    // A current, empty NWS feed correctly means no active alerts; no issue.
  } catch {
    problems.push({ code: 'live:probe', severity: 'critical', message: 'Current-context API failed, returned invalid data, or monitor configuration is missing. Check the endpoint and Actions variables.' });
  }
  try {
    const base = supabaseBaseUrl(url);
    if (!publishableKey?.startsWith('sb_publishable_')) throw new Error('A public key is required');
    const read = async (table, columns, limit) => readBoundedJson(await fetcher(
      `${base}/rest/v1/${table}?select=${columns}&limit=${limit}`, {
        headers: { apikey: publishableKey, Accept: 'application/json' }, method: 'GET',
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      }), 1_000_000);
    const [evidence, profiles, boundaries, sources] = await Promise.all([
      read('neighborhood_category_evidence', 'neighborhood_id,category_id,refresh_due_at,prepared_at,boundary_version,dependencies', 705),
      read('neighborhood_profiles', 'neighborhood_id,data_version', 89),
      read('neighborhood_boundaries', 'neighborhood_id,boundary_version', 89),
      read('neighborhood_sources', 'source_id,data_version,boundary_version', 9),
    ]);
    problems.push(...referenceProblems({ evidence, profiles, boundaries, sources }, now));
    checkedBoundaries = boundaries;
  } catch {
    // Never put provider error bodies, credentials, or arbitrary source text in issues.
    problems.push({ code: 'reference:probe', severity: 'critical', message: 'Reference metadata API failed or the expected 88 neighborhoods, eight inventories, or 704 evidence rows are incomplete/invalid. Check publication and Actions variables.' });
  }
  try {
    const base = supabaseBaseUrl(url);
    if (!publishableKey?.startsWith('sb_publishable_')) throw new Error('Public key required');
    const read = async (path) => readBoundedJson(await fetcher(`${base}/rest/v1/${path}`, {
      method: 'GET', headers: { apikey: publishableKey }, signal: AbortSignal.timeout(15000), redirect: 'error',
    }), 100000);
    const [sources, rows] = await Promise.all([
      read('neighborhood_supplement_sources?select=source_id,source_checked_at,refresh_due_at,boundary_version&limit=3'),
      read('neighborhood_supplements?select=source_id,neighborhood_id&limit=177'),
    ]);
    problems.push(...supplementProblems({ sources, rows, boundaries: checkedBoundaries }, now));
  } catch {
    problems.push({ code: 'supplement:probe', severity: 'critical', message: 'Optional context metadata is unavailable/incomplete. Verify both source manifests and 176 neighborhood summaries.' });
  }
  return problems.sort((a, b) => a.code.localeCompare(b.code));
}

export async function syncIssue({ problems, repository, token, fetch: fetcher = fetch, now = new Date().toISOString() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token) throw new Error('GitHub monitor configuration missing');
  const api = async (path, method = 'GET', body) => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    return readBoundedJson(response, 4_000_000);
  };
  const matches = [];
  for (let page = 1; ; page++) {
    const issues = await api(`issues?state=all&per_page=100&page=${page}`);
    if (!Array.isArray(issues)) throw new Error('Invalid GitHub issue response');
    matches.push(...issues.filter(i => !i.pull_request && i.user?.login === 'github-actions[bot]' && i.body?.includes(MARKER)));
    if (issues.length < 100) break;
    if (page === 20) throw new Error('Issue pagination exceeded monitor bound');
  }
  const issue = matches.sort((a, b) => a.number - b.number)[0];
  const fingerprint = createHash('sha256').update(JSON.stringify(problems)).digest('hex');
  const stamp = `<!-- status:${fingerprint} -->`;
  const healthy = !problems.length;
  if (!issue && healthy) return 'healthy';
  if (issue?.body.includes(stamp) && issue.state === (healthy ? 'closed' : 'open')) return 'unchanged';
  const body = `${MARKER}\n${stamp}\nOwner: @Akretic-Sean\n\n${healthy ? 'All monitored checks have recovered.' : problems.map(p => `- **${p.severity}** — ${p.message}`).join('\n')}\n\nChecked: ${now}\n\nRunbook: https://github.com/${repository}/blob/main/docs/data-operations.md\nMonitor runs: https://github.com/${repository}/actions/workflows/data-monitor.yml\n\nThis checks actual public API data and freshness, not Cron enqueue success. Reference expiry warnings start 14 days before the earliest deadline. Repeated identical findings do not create comments or new issues.`;
  await api(issue ? `issues/${issue.number}` : 'issues', issue ? 'PATCH' : 'POST', {
    title: 'Backend data health: refresh failures and reference expiry', body,
    assignees: ['Akretic-Sean'], ...(issue ? { state: healthy ? 'closed' : 'open' } : {}),
  });
  return healthy ? 'closed' : issue ? 'updated' : 'created';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const problems = await checkHealth({ url: process.env.SUPABASE_URL, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY });
    console.log(JSON.stringify({ checked_at: new Date().toISOString(), problems }, null, 2));
    if (process.argv.includes('--issue')) console.log(`Issue: ${await syncIssue({ problems, repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN })}`);
    if (problems.some(p => p.severity === 'critical')) process.exitCode = 1;
  } catch {
    console.error('Data monitor failed to report its result. Check Actions configuration and GitHub availability.');
    process.exitCode = 1;
  }
}
