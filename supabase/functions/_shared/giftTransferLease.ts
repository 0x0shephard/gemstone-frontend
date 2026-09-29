import { adminClient } from './auth.ts';

type AdminClient = ReturnType<typeof adminClient>;

// Share the operator-wide lease with seller activation. Both workflows sign
// with the same account, so separate locks would still be able to allocate the
// same pending nonce concurrently.
const OPERATOR_LEASE = 'sepolia-seller-activation';
const LEASE_MS = 3 * 60_000;

export async function claimGiftTransferLease(
  admin: AdminClient,
  operationId: string,
): Promise<boolean> {
  const now = new Date();
  const { data, error } = await admin
    .from('protocol_operator_leases')
    .update({
      holder_id: operationId,
      expires_at: new Date(now.getTime() + LEASE_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('lease_name', OPERATOR_LEASE)
    .or(`expires_at.lt.${now.toISOString()},holder_id.eq.${operationId}`)
    .select('lease_name')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function releaseGiftTransferLease(
  admin: AdminClient,
  operationId: string,
): Promise<void> {
  // Releasing is best-effort. An expired lease is recoverable; turning a
  // confirmed transfer into an HTTP failure because cleanup failed is not.
  await admin
    .from('protocol_operator_leases')
    .update({
      holder_id: null,
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('lease_name', OPERATOR_LEASE)
    .eq('holder_id', operationId);
}
