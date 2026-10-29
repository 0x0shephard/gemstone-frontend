import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * The one lease every writer that signs with the operator key must hold.
 *
 * Seller activation, gift transfers, redemptions and the auction sweep all send
 * from the same account, so any two of them running at once can allocate the
 * same pending nonce. The stored value predates the other writers and still
 * says "seller activation"; it is not renamed because running code and the seed
 * row in `202607250003_operator_lease.sql` share it.
 */
export const OPERATOR_LEASE_NAME = 'sepolia-seller-activation';

/** Claims the lease if it is free, expired, or already held by `holderId`. */
export async function claimOperatorLease(
  admin: SupabaseClient,
  holderId: string,
  durationMs: number,
): Promise<boolean> {
  const now = new Date();
  const { data, error } = await admin
    .from('protocol_operator_leases')
    .update({
      holder_id: holderId,
      expires_at: new Date(now.getTime() + durationMs).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('lease_name', OPERATOR_LEASE_NAME)
    .or(`expires_at.lt.${now.toISOString()},holder_id.eq.${holderId}`)
    .select('lease_name')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Extends the lease, but only for the holder already holding it. Returns whether
 * it is still held, so a writer that lost it can stop before its next send.
 */
export async function renewOperatorLease(
  admin: SupabaseClient,
  holderId: string,
  durationMs: number,
): Promise<boolean> {
  const now = new Date();
  const { data, error } = await admin
    .from('protocol_operator_leases')
    .update({
      expires_at: new Date(now.getTime() + durationMs).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('lease_name', OPERATOR_LEASE_NAME)
    .eq('holder_id', holderId)
    .select('lease_name')
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/** Best-effort: an expired lease is recoverable, a failed cleanup must not fail the caller. */
export async function releaseOperatorLease(admin: SupabaseClient, holderId: string): Promise<void> {
  await admin
    .from('protocol_operator_leases')
    .update({
      holder_id: null,
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('lease_name', OPERATOR_LEASE_NAME)
    .eq('holder_id', holderId);
}
