import type { Hash } from 'viem';

const DEFAULT_RECONCILIATION_DELAYS_MS = [0, 1_000, 2_500, 5_000, 7_500] as const;
const USER_REJECTION =
  /(?:user|request).*(?:reject|deni|cancel)|(?:reject|deni|cancel).*(?:user|request)/i;
const AMBIGUOUS_BROADCAST_FAILURE =
  /unknown rpc|eth_sendrawtransaction|nsurlerrordomain|\b-1005\b|network connection was lost|connection (?:was )?(?:lost|closed|reset)|socket hang up|failed to fetch|network request failed/i;

/** Flattens viem/provider wrapper errors without assuming a particular wallet SDK shape. */
export function walletErrorText(error: unknown): string {
  const parts: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 10 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    if (typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    for (const key of ['name', 'shortMessage', 'message', 'details']) {
      if (typeof record[key] === 'string') parts.push(record[key]);
    }
    current = record.cause;
  }

  return parts.join(' · ');
}

/**
 * Wallets can broadcast successfully and still reject the JSON-RPC promise when
 * iOS suspends their network connection during the return app switch.
 */
export function isAmbiguousWalletBroadcastError(error: unknown): boolean {
  const text = walletErrorText(error);
  return !USER_REJECTION.test(text) && AMBIGUOUS_BROADCAST_FAILURE.test(text);
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds === 0
    ? Promise.resolve()
    : new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

/**
 * Looks for the chain effect after an ambiguous wallet error. A recovered hash
 * turns the false failure back into the normal receipt-confirmation path.
 */
export async function recoverAmbiguousWalletBroadcast(
  error: unknown,
  reconcile: () => Promise<Hash | undefined>,
  delaysMs: readonly number[] = DEFAULT_RECONCILIATION_DELAYS_MS,
): Promise<Hash | undefined> {
  if (!isAmbiguousWalletBroadcastError(error)) return;
  for (const delayMs of delaysMs) {
    await wait(delayMs);
    try {
      const hash = await reconcile();
      if (hash) return hash;
    } catch {
      // A public RPC may be waking up too; the next bounded attempt can succeed.
    }
  }
}

export const WALLET_NETWORK_FAILURE_MESSAGE =
  'MetaMask lost its Sepolia connection while returning to the browser. No matching transaction appeared yet. Reopen MetaMask, confirm Sepolia is selected, then return and try once more.';
