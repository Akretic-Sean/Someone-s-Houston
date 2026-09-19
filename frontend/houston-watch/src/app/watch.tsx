'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUsd, normalise, outsideHouston, type Listing } from '@/lib/listing';

type ListingType = 'sale' | 'rent';
type ApiError = { kind: string; message: string };

const POLL_MS = 3000;
const TERMINAL = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];

export default function Watch() {
  const [type, setType] = useState<ListingType>('sale');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const poll = useRef<number | undefined>(undefined);

  const load = useCallback(async (which: ListingType) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/listings?type=${which}`);
      const body = await response.json();
      if (!response.ok) {
        setListings(null);
        setError(body.error ?? { kind: 'upstream', message: 'Could not load listings.' });
        return;
      }
      setListings((body as unknown[]).map(normalise));
    } catch {
      setListings(null);
      setError({ kind: 'network', message: 'Could not reach the server.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(type);
  }, [type, load]);

  useEffect(() => () => clearTimeout(poll.current), []);

  async function startRun() {
    if (running) return;
    setRunning(true);
    setRunStatus('STARTING');
    setError(null);
    try {
      const response = await fetch(`/api/run?type=${type}`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? { kind: 'upstream', message: 'Could not start a run.' });
        setRunning(false);
        setRunStatus(null);
        return;
      }
      pollRun(body.id);
    } catch {
      setError({ kind: 'network', message: 'Could not reach the server.' });
      setRunning(false);
      setRunStatus(null);
    }
  }

  function pollRun(runId: string) {
    const tick = async () => {
      try {
        const response = await fetch(`/api/run/${runId}`);
        const body = await response.json();
        if (!response.ok) throw new Error('poll failed');
        setRunStatus(body.status);
        if (TERMINAL.includes(body.status)) {
          setRunning(false);
          if (body.status === 'SUCCEEDED') void load(type);
          return;
        }
        poll.current = window.setTimeout(tick, POLL_MS);
      } catch {
        setError({ kind: 'network', message: 'Lost track of the run. It may still be going.' });
        setRunning(false);
      }
    };
    poll.current = window.setTimeout(tick, POLL_MS);
  }

  const strays = listings?.filter(outsideHouston).length ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-orange-400">
            Houston Watch
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Listings from your Apify task
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="inline-flex rounded-full border border-white/15 bg-black/30 p-1"
            role="group"
            aria-label="Listing type"
          >
            {(['sale', 'rent'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  type === t ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'
                }`}
              >
                {t === 'sale' ? 'For sale' : 'To rent'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={startRun}
            disabled={running}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {running ? `Running… ${runStatus ?? ''}` : 'Run now'}
          </button>
        </div>
      </header>

      {running ? (
        <p className="mb-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
          Run status: <span className="font-mono">{runStatus}</span>. This bills your Apify
          account per result.
        </p>
      ) : null}

      {error ? (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-orange-400">
            {error.kind === 'no_run' ? 'Nothing to show yet' : 'Could not load'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/75">{error.message}</p>
          {error.kind === 'no_run' ? (
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              The task exists but has never completed a run. Press{' '}
              <span className="font-semibold">Run now</span> to create one.
            </p>
          ) : null}
        </div>
      ) : null}

      {strays > 0 ? (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-amber-300">
            Check the task&rsquo;s search area
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/75">
            {strays} of {listings?.length} listings fall outside the Houston area. The saved
            Zillow search is probably pointed somewhere else.
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-white/55">Loading…</p>
      ) : listings && listings.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <li
              key={l.key}
              className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
            >
              {l.imageUrl ? (
                // Arbitrary remote hosts; plain img avoids configuring every one.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.imageUrl} alt="" className="h-40 w-full object-cover" />
              ) : (
                <div className="flex h-40 items-center justify-center bg-black/30 text-xs text-white/40">
                  No photo
                </div>
              )}

              <div className="p-4">
                <p className="text-lg font-semibold">
                  {l.priceLabel ?? formatUsd(l.price) ?? (
                    <span className="text-sm font-normal italic text-white/40">
                      Price unavailable
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {l.address ?? <span className="italic text-white/40">Address unavailable</span>}
                </p>

                <p className="mt-3 font-mono text-xs text-white/55">
                  {[
                    l.beds !== null ? `${l.beds} bd` : null,
                    l.baths !== null ? `${l.baths} ba` : null,
                    l.area !== null
                      ? `${l.area.toLocaleString('en-US')} ${l.areaUnit ?? 'sqft'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Details unavailable'}
                </p>

                <p className="mt-1 text-xs text-white/45">
                  {[
                    l.homeType,
                    l.status,
                    l.daysOnZillow !== null
                      ? l.daysOnZillow === 0
                        ? 'New today'
                        : `${l.daysOnZillow} days on Zillow`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                {outsideHouston(l) ? (
                  <p className="mt-2 text-xs text-amber-300">Outside the Houston area</p>
                ) : null}

                {l.detailUrl ? (
                  <a
                    href={l.detailUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 inline-block text-sm font-semibold text-teal-300 hover:underline"
                  >
                    View on Zillow →
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : !error ? (
        <p className="text-sm text-white/55">
          The last run succeeded but returned no listings.
        </p>
      ) : null}
    </main>
  );
}
