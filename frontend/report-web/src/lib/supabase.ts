import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config';

/**
 * Browser Supabase client for the shared Someone's Houston project.
 * Uses the publishable key only — RLS applies to every call.
 *
 * Null when the env vars are missing, so the prototype still runs
 * without login; live report generation remains unavailable until configured.
 */
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
