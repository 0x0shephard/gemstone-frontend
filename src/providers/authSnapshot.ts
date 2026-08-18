/**
 * The small, synchronous part of auth that transaction preflight needs.
 *
 * AuthProvider has already loaded and verified this information before a
 * signed-in person can reach a transaction. Re-querying Supabase for the same
 * wallet link on every click added a network dependency to the path between a
 * tap and MetaMask; after an iOS app switch that request could remain pending
 * indefinitely and leave the button at "Checking your wallet…".
 */
export interface TransactionAuthSnapshot {
  loading: boolean;
  userId: string | null;
  linkedWallet: string | null;
}

let snapshot: TransactionAuthSnapshot = {
  loading: true,
  userId: null,
  linkedWallet: null,
};

export function setTransactionAuthSnapshot(next: TransactionAuthSnapshot): void {
  snapshot = next;
}

export function getTransactionAuthSnapshot(): TransactionAuthSnapshot {
  return snapshot;
}
