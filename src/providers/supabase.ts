import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, authConfigured } from '@/config/env';
import { protocolDeploymentHeaders } from '@/config/deployment';

export function supabaseClientOptions(release = env.deploymentRelease) {
  const headers = protocolDeploymentHeaders(release);
  return {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    ...(headers ? { global: { headers } } : {}),
  };
}

/**
 * A single Supabase client, or `null` when auth env is not configured. The
 * AuthProvider degrades to a clearly-labelled "auth not configured" state
 * rather than crashing, so the UI is fully explorable without secrets.
 */
export const supabase: SupabaseClient | null = authConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, supabaseClientOptions())
  : null;
