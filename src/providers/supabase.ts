import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, authConfigured } from '@/config/env';

/**
 * A single Supabase client, or `null` when auth env is not configured. The
 * AuthProvider degrades to a clearly-labelled "auth not configured" state
 * rather than crashing, so the UI is fully explorable without secrets.
 */
export const supabase: SupabaseClient | null = authConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
