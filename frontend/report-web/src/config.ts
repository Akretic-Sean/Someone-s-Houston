/**
 * Runtime configuration. Vite only exposes `VITE_`-prefixed variables to the
 * browser bundle, which is the guard against a secret key being shipped by
 * accident. See `.env.example`.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/** False until configured; live report generation is blocked without it. */
export const hasLiveData = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

if (SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_')) {
  throw new Error(
    'A secret Supabase key is configured for the browser bundle. Use the sb_publishable_ key.',
  );
}

/**
 * Listing Watch Agent webhook. The browser POSTs a consented watch request
 * here; scheduling, scraping and delivery happen server-side. Unset until the
 * endpoint exists, in which case the UI says so rather than pretending.
 */
export const LISTING_WATCH_WEBHOOK: string =
  import.meta.env.VITE_LISTING_WATCH_WEBHOOK_URL ?? '';

export const hasListingWatch = Boolean(LISTING_WATCH_WEBHOOK);
