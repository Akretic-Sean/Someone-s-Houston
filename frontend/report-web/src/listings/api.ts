import { LISTINGS_API } from '../config';
import { normalise, type Listing } from './listing';

/**
 * Reads listings through the Houston Watch API, never Apify directly: this app
 * is a static bundle and an Apify token in it would be public. That service
 * holds the token and allow-lists this origin. Swapping it for an edge function
 * later is one env var.
 */

export class ListingsError extends Error {
  constructor(
    message: string,
    readonly kind: 'unconfigured' | 'no_run' | 'unavailable',
  ) {
    super(message);
    this.name = 'ListingsError';
  }
}

export type ListingType = 'sale' | 'rent';

const TIMEOUT_MS = 20_000;

export async function fetchListings(type: ListingType): Promise<Listing[]> {
  if (!LISTINGS_API) {
    throw new ListingsError('The listings service is not configured.', 'unconfigured');
  }

  let response: Response;
  try {
    response = await fetch(`${LISTINGS_API}?type=${type}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ListingsError('The listings service could not be reached.', 'unavailable');
  }

  if (!response.ok) {
    let kind: ListingsError['kind'] = 'unavailable';
    let message = 'Listings are temporarily unavailable.';
    try {
      const body = await response.json();
      if (body?.error?.kind === 'no_run') {
        kind = 'no_run';
        message = 'This search has not completed a run yet, so there is nothing to show.';
      }
    } catch {
      // Keep the generic message.
    }
    throw new ListingsError(message, kind);
  }

  const body = await response.json();
  return Array.isArray(body) ? body.map(normalise) : [];
}
