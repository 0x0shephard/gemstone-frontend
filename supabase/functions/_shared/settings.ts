import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Operator-controlled runtime settings.
 *
 * Read on the service role from inside Edge Functions. `protocol_settings` has no
 * client write policy, so a seller cannot choose the cheaper verification path
 * for their own submission.
 */

type AdminClient = SupabaseClient;

export type VerificationMode = 'lab' | 'auto';

export const VERIFICATION_MODE_KEY = 'verification_mode';

/**
 * Which path a new submission takes.
 *
 * Defaults to `lab` when the row is missing or unreadable. The automated
 * valuation is explicitly test-only and writes to a field with no setter, so an
 * unavailable settings row must not silently enable it.
 */
export async function verificationMode(admin: AdminClient): Promise<VerificationMode> {
  const { data, error } = await admin
    .from('protocol_settings')
    .select('value')
    .eq('key', VERIFICATION_MODE_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.value === 'auto' ? 'auto' : 'lab';
}

export async function setVerificationMode(
  admin: AdminClient,
  mode: VerificationMode,
  updatedBy: string,
): Promise<void> {
  const { error } = await admin.from('protocol_settings').upsert(
    {
      key: VERIFICATION_MODE_KEY,
      value: mode,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
}
