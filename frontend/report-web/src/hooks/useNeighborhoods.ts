import { useEffect, useState } from 'react';
import {
  fetchNeighborhoodProfiles,
  NeighborhoodDataError,
  type NeighborhoodProfile,
} from '../data/neighborhoodApi';

export interface NeighborhoodsState {
  rows: NeighborhoodProfile[] | null;
  loading: boolean;
  error: NeighborhoodDataError | null;
  /** Bumping this retries; only offered for `unavailable`, which is transient. */
  retry: () => void;
}

export function useNeighborhoods(): NeighborhoodsState {
  const [rows, setRows] = useState<NeighborhoodProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<NeighborhoodDataError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);

    fetchNeighborhoodProfiles()
      .then((data) => {
        if (!live) return;
        setRows(data);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRows(null);
        setError(
          err instanceof NeighborhoodDataError
            ? err
            : new NeighborhoodDataError('Neighborhood data could not be read.', 'unavailable'),
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  return { rows, loading, error, retry: () => setAttempt((a) => a + 1) };
}
