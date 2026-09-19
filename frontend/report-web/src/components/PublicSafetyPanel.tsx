import { useEffect, useState } from 'react';
import { Card } from './Bits';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config';
import { readBoundedJson } from '../data/scoringClient.mjs';

const SOURCE = 'https://services.arcgis.com/NummVBqZSIJKUeVR/ArcGIS/rest/services/HPD_Crime_Summary/FeatureServer/0';
const FIELDS = { aggravated_assault: 'Aggravated assault', robbery: 'Robbery', burglary: 'Burglary', motor_vehicle_theft: 'Motor vehicle theft', theft_from_motor_vehicle: 'Theft from vehicles' };
type Crime = { counts: Record<string, number | null>; due: number; checked: string; period: string };

export default function PublicSafetyPanel({ neighborhoodId, name, now }: { neighborhoodId: number; name: string; now: number }) {
  const [crime, setCrime] = useState<Crime | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;
    setCrime(null); setLoading(true);
    async function load() {
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_neighborhood_relocation_context`, {
          method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_neighborhood_id: neighborhoodId }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), redirect: 'error',
        });
        if (!response.ok) throw new Error('Unavailable');
        const body = await readBoundedJson(response, 150000) as any;
        const block = body?.reported_crime;
        const due = Math.min(Date.parse(block?.refresh_due_at), Date.parse(block?.source?.refresh_due_at));
        const counts = block?.facts?.counts;
        if (body?.neighborhood_id !== neighborhoodId || body?.scoring_effect !== 'none'
          || block?.availability !== 'historical_snapshot' || block?.facts?.year !== 2024
          || block?.source?.source_url !== SOURCE || !Number.isFinite(due) || due <= Date.now()
          || !Number.isFinite(Date.parse(block?.source?.source_checked_at))
          || typeof block?.source?.source_period !== 'string' || !counts
          || Object.keys(FIELDS).some(key => counts[key] !== null && (!Number.isInteger(counts[key]) || counts[key] < 0 || counts[key] > 1000000))) throw new Error('Unavailable');
        if (!active) return;
        setCrime({ counts, due, checked: block.source.source_checked_at, period: block.source.source_period });
        timer = window.setTimeout(() => { setCrime(null); setAttempt(value => value + 1); }, Math.min(due - Date.now(), 3600000));
      } catch { if (active) setCrime(null); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [neighborhoodId, attempt]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { setCrime(null); setAttempt(value => value + 1); } };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  const usable = crime && crime.due > now ? crime : null;
  return <section aria-labelledby="public-safety-heading" className="public-safety-panel"><Card>
    <span className="eyebrow">Public records · Not included in scores</span>
    <h3 id="public-safety-heading">Public safety context</h3>
    <p>Reported crime in {name} · 2024</p>
    {loading ? <p className="source" role="status">Loading historical HPD records…</p>
      : usable ? <><dl className="crime-counts">{Object.entries(FIELDS).map(([key, label]) => <div key={key}>
        <dt>{label}</dt><dd>{usable.counts[key] === null ? 'Unavailable' : usable.counts[key].toLocaleString()}</dd>
      </div>)}</dl><p className="source">{usable.period} Source checked {new Date(usable.checked).toLocaleDateString()}.</p></>
      : <p className="source">Historical crime data is unavailable or needs a source refresh. <button type="button" className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry public safety data</button></p>}
    <p className="source">These are selected reported offense counts, not unique incidents, population-adjusted rates, current conditions or a safety rating. Neighborhood size, visitors and reporting practices differ. These counts do not affect your priorities, neighborhood scores or ranking.</p>
    <a className="source" href={SOURCE} target="_blank" rel="noreferrer">View official City / HPD crime source</a>
  </Card></section>;
}
