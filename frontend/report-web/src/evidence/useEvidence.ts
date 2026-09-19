import { useEffect, useState } from 'react';
import { NeighborhoodDataError } from '../data/neighborhoodApi';
import { fetchEvidence, nextExpiry } from './api';
import type { EvidencePayload } from './types';

export interface EvidenceState {
  payload: EvidencePayload | null;
  loading: boolean;
  error: NeighborhoodDataError | null;
  retry: () => void;
}

/**
 * Evidence for one neighborhood.
 *
 * Superseded requests are ignored after a selection change, a failure clears
 * the previous payload rather than leaving stale facts on screen, and an
 * expiry timer re-reads if the screen is left open past `refresh_due_at`.
 */
export function useEvidence(neighborhoodId: number | null): EvidenceState {
  const [payload, setPayload] = useState<EvidencePayload | null>(null);
  const [loading, setLoading] = useState(neighborhoodId !== null);
  const [error, setError] = useState<NeighborhoodDataError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (neighborhoodId === null) {
      setPayload(null);
      setLoading(false);
      setError(null);
      return;
    }

    let current = true;
    let expiryTimer: number | undefined;
    setLoading(true);
    setError(null);

    fetchEvidence(neighborhoodId)
      .then((data) => {
        if (!current) return;
        setPayload(data);

        const due = nextExpiry(data);
        if (due !== null) {
          const delay = due - Date.now();
          // setTimeout saturates past ~24.8 days; only arm a plausible timer.
          if (delay > 0 && delay < 2_000_000_000) {
            expiryTimer = window.setTimeout(() => {
              if (current) setAttempt((a) => a + 1);
            }, delay);
          }
        }
      })
      .catch((err: unknown) => {
        if (!current) return;
        // A failed read must withhold, not fall back to what we had.
        setPayload(null);
        setError(
          err instanceof NeighborhoodDataError
            ? err
            : new NeighborhoodDataError('Evidence could not be read.', 'unavailable'),
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [neighborhoodId, attempt]);

  // Deadlines are re-checked when a hidden tab comes back.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setAttempt((a) => a + 1);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return { payload, loading, error, retry: () => setAttempt((a) => a + 1) };
}
