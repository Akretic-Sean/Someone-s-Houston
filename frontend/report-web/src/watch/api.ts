import { LISTING_WATCH_WEBHOOK } from '../config';
import type { WatchRequest } from './types';

export class WatchError extends Error {
  constructor(
    message: string,
    readonly kind: 'unconfigured' | 'rejected' | 'unavailable',
  ) {
    super(message);
    this.name = 'WatchError';
  }
}

const TIMEOUT_MS = 15_000;

/**
 * Creates a watch. Deliberately thin: the browser holds no Apify token, no
 * scheduling logic and no seen-list. It sends a consented request and nothing
 * more.
 */
export async function createWatch(request: WatchRequest): Promise<void> {
  if (!LISTING_WATCH_WEBHOOK) {
    throw new WatchError('The listing watch endpoint is not configured.', 'unconfigured');
  }

  let response: Response;
  try {
    response = await fetch(LISTING_WATCH_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WatchError('The listing watch service could not be reached.', 'unavailable');
  }

  if (!response.ok) {
    throw new WatchError(
      response.status >= 400 && response.status < 500
        ? 'The listing watch request was rejected.'
        : 'The listing watch service is temporarily unavailable.',
      response.status >= 400 && response.status < 500 ? 'rejected' : 'unavailable',
    );
  }
}
