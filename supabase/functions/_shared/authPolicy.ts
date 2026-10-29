/**
 * Pure authorization rules, kept apart from `auth.ts` so they can be tested
 * without loading the Supabase client (Deno `npm:` specifiers do not resolve
 * under vitest).
 */

/**
 * Whether a Supabase user is an anonymous sign-in.
 *
 * An anonymous sign-in still gets the `authenticated` role, so every check that
 * only asks "is there a session" let a script mint unlimited throwaway accounts
 * and use them to host files, spam nonce and push rows, and link wallets.
 * GoTrue reports it as `user.is_anonymous` (and as the `is_anonymous` JWT
 * claim, which the RLS policies check).
 */
export function isAnonymousUser(user: { is_anonymous?: boolean | null } | null): boolean {
  return user?.is_anonymous === true;
}

/**
 * The chain every SIWE message must name, read from `CHAIN_ID`.
 *
 * There is deliberately no default. The previous `?? 11155111` meant a
 * production deployment that lost its secret silently went back to accepting
 * Sepolia signatures; now it refuses instead.
 */
export function configuredChainId(raw: string | undefined | null): number | null {
  const value = raw?.trim();
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const chainId = Number(value);
  return Number.isSafeInteger(chainId) ? chainId : null;
}

/** How far ahead of the server a wallet's clock may be when it stamps `issuedAt`. */
export const SIWE_CLOCK_SKEW_MS = 60_000;

export interface SiweTimeFields {
  issuedAt?: Date;
  expirationTime?: Date;
  notBefore?: Date;
}

/**
 * Whether a SIWE message's timestamps are acceptable at `now`.
 *
 * `issuedAt` comes from the signer's device clock, which is routinely a few
 * seconds ahead; refusing anything later than the server's own clock rejected
 * real users for a reason they could not see. Expiry is the server's own nonce
 * expiry, so it gets no tolerance.
 */
export function siweTimesValid(
  fields: SiweTimeFields,
  now: Date,
  skewMs = SIWE_CLOCK_SKEW_MS,
): boolean {
  const { issuedAt, expirationTime, notBefore } = fields;
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) return false;
  if (!(expirationTime instanceof Date) || Number.isNaN(expirationTime.getTime())) return false;
  if (issuedAt.getTime() > now.getTime() + skewMs) return false;
  if (expirationTime.getTime() <= now.getTime()) return false;
  if (notBefore && notBefore.getTime() > now.getTime() + skewMs) return false;
  return true;
}

export type WalletSignatureKind = 'eoa' | 'contract';

export interface WalletLinkProof {
  chain_id: number | string | null;
  signature_kind?: WalletSignatureKind | string | null;
}

/**
 * Whether a wallet link proves control of the address on `chainId`.
 *
 * An EOA's key controls the same address on every chain, so a link proven by
 * an EOA signature holds everywhere. A contract wallet (ERC-1271 / ERC-6492)
 * is a different contract, possibly with different owners or none at all, on
 * each chain: a Safe proven on Sepolia says nothing about who controls that
 * address on Arbitrum One. Links written before the signature kind was recorded
 * are treated as contract links.
 */
export function walletLinkTrustedOn(link: WalletLinkProof | null, chainId: number | null): boolean {
  if (!link) return false;
  if (link.signature_kind === 'eoa') return true;
  if (chainId === null) return false;
  return Number(link.chain_id) === chainId;
}
