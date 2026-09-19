import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundedScoringPayload } from '../../../../shared/scoring-estimates.mjs';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { createScoringClient, nextScoringDeadline } from '../data/scoringClient.mjs';

const client = createScoringClient({ url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });

export function useScoringData() {
  const [payload, setPayload] = useState<BoundedScoringPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(async (force = false) => {
    if (force) client.invalidate();
    setLoading(true);
    setError(null);
    try {
      const data = await client.load();
      if (alive.current) {
        setPayload(data);
        setLoadedAt(Date.now());
      }
      return data;
    } catch (reason) {
      if (alive.current) {
        setPayload(null);
        setError(reason instanceof Error ? reason.message : 'Scoring data could not be loaded. Please retry.');
      }
      throw reason;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => {});
    return () => { alive.current = false; };
  }, [refresh]);

  useEffect(() => {
    const reload = () => { void refresh().catch(() => {}); };
    const visible = () => { if (document.visibilityState === 'visible') reload(); };
    const deadline = payload ? nextScoringDeadline(payload) : null;
    const delay = Math.max(10, Math.min(client.nextRefreshAt() ?? loadedAt + 3_600_000, deadline ?? Infinity) - Date.now());
    const timer = payload ? window.setTimeout(reload, delay) : undefined;
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [payload, loadedAt, refresh]);

  return { payload, loading, error, refresh, loadedAt };
}
