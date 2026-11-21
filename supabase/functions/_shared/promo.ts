/**
 * Pure helpers for promotional claims, kept free of `npm:` imports so vitest
 * can load them.
 */

/** Upper-cases and strips spaces and dashes; null unless 4–32 letters and digits. */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}

export type PromoRefusal = 'closed' | 'sold_out' | 'already_claimed' | 'not_found';

const REFUSALS: Record<string, { state: PromoRefusal; message: string }> = {
  promo_not_found: { state: 'not_found', message: 'That code is not valid' },
  promo_closed: { state: 'closed', message: 'This promotion has ended' },
  promo_sold_out: { state: 'sold_out', message: 'Every stone in this promotion has been claimed' },
  promo_already_claimed: {
    state: 'already_claimed',
    message: 'This email or wallet has already claimed a stone with this code',
  },
};

/** Maps an `assign_promo_token` exception to user text, or null if unknown. */
export function promoErrorMessage(
  databaseMessage: string | undefined,
): { state: PromoRefusal; message: string } | null {
  if (!databaseMessage) return null;
  const key = Object.keys(REFUSALS).find((candidate) => databaseMessage.includes(candidate));
  return key ? REFUSALS[key] : null;
}

/**
 * A claim is recorded against one wallet, and only that wallet may receive its
 * stone. `v1-gift-claim` sends to the caller's primary wallet at transfer time,
 * so a claimant who switched wallets between claiming and the transfer would
 * otherwise route the stone to a wallet no claim records, which could then
 * claim again from another account. Null when the wallets match.
 */
export function claimWalletMismatch(recordedWallet: string, currentWallet: string): string | null {
  if (recordedWallet.toLowerCase() === currentWallet.toLowerCase()) return null;
  const short = `${recordedWallet.slice(0, 6)}…${recordedWallet.slice(-4)}`;
  return `This claim was made for wallet ${short}. Make it your primary wallet again to receive the stone.`;
}
