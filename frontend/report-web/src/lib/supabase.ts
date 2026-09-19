import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Browser Supabase client for the shared Someone's Houston project.
 * Uses the publishable key only — RLS applies to every call.
 *
 * Null when the env vars are missing, so the prototype still runs
 * offline with mocked data. Copy .env.example to .env to enable auth.
 */
export const supabase: SupabaseClient | null =
  url && publishableKey
    ? createClient(url, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
