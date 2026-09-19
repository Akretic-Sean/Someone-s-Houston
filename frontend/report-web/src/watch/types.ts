/** Request contract for the separately configured listing-watch webhook. */
export interface WatchRequest {
  /** Browser-session correlation ID; this version does not persist report records. */
  reportId: string;
  /** City POLYIDs, 1-88 — the same canonical join key the evidence layer uses. */
  neighborhoodIds: number[];
  neighborhoodNames: string[];
  listingType: ListingType;
  /** Free text, scored by a model against the property only, never the area. */
  softCriteria: string;
  officeId: string;
  delivery: {
    channel: 'email';
    email: string;
  };
  /** Must be literally true. The server must re-check, not trust this. */
  consent: true;
  /** Stated in the UI so what the candidate agreed to is unambiguous. */
  cadence: 'weekly';
  expiresAfterWeeks: number;
}

export type ListingType = 'sale' | 'rent' | 'both';

export const WATCH_EXPIRY_WEEKS = 12;
