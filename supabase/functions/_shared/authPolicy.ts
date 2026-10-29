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

export type WalletLinkTrust = 'trusted' | 'untrusted' | 'legacy';

/**
 * Whether a wallet link proves control of the address on `chainId`.
 *
 * An EOA's key controls the same address on every chain, so a link proven by
 * an EOA signature holds everywhere. A contract wallet (ERC-1271 / ERC-6492)
 * is a different contract, possibly with different owners or none at all, on
 * each chain: a Safe proven on Sepolia says nothing about who controls that
 * address on Arbitrum One.
 *
 * `legacy` is a link written before the signature kind was recorded and proven
 * on another chain. It counts as an EOA link exactly when the address has no
 * code on `chainId`, which `walletLinkTrustedOn` settles with `eth_getCode`.
 */
export function walletLinkTrust(
  link: WalletLinkProof | null,
  chainId: number | null,
): WalletLinkTrust {
  if (!link) return 'untrusted';
  if (link.signature_kind === 'eoa') return 'trusted';
  if (chainId === null) return 'untrusted';
  if (Number(link.chain_id) === chainId) return 'trusted';
  return link.signature_kind === 'contract' ? 'untrusted' : 'legacy';
}

/** "Does this address have no contract code on the active chain?" Null when unknown. */
export type CodelessCheck = (address: string) => Promise<boolean | null>;

/**
 * {@link walletLinkTrust}, with a legacy link settled by `isCodeless`.
 *
 * If the check cannot answer (no RPC configured, an RPC error), the legacy
 * link is not trusted for this call. Nothing is written, so a later call can
 * still trust it once the RPC answers.
 */
export async function walletLinkTrustedOn(
  link: WalletLinkProof | null,
  chainId: number | null,
  address: string,
  isCodeless: CodelessCheck | null,
): Promise<boolean> {
  const trust = walletLinkTrust(link, chainId);
  if (trust !== 'legacy') return trust === 'trusted';
  if (!isCodeless) return false;
  return (await isCodeless(address).catch(() => null)) === true;
}

/**
 * Whether `eth_getCode` output means "no contract": empty, or an EIP-7702
 * delegation designator (`0xef0100` + 20-byte address), which is still an EOA
 * whose key controls the address on every chain. Null for malformed output.
 */
export function codeIsCodeless(code: unknown): boolean | null {
  if (typeof code !== 'string' || !/^0x[0-9a-f]*$/i.test(code)) return null;
  if (code === '0x' || code === '0x0') return true;
  return /^0xef0100[0-9a-f]{40}$/i.test(code);
}

/**
 * A {@link CodelessCheck} backed by one JSON-RPC `eth_getCode` per address, with
 * a 3 s timeout. Definite answers are cached in `cache` (pass a module-level
 * map so a sweep pays once per address). Null when no RPC URL is configured.
 */
export function rpcCodelessCheck(
  rpcUrl: string | undefined | null,
  cache: Map<string, boolean> = new Map(),
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): CodelessCheck | null {
  const url = rpcUrl?.trim();
  if (!url) return null;
  return async (address) => {
    const key = `${url}|${address.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getCode',
          params: [address.toLowerCase(), 'latest'],
        }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { result?: unknown } | null;
      const codeless = codeIsCodeless(body?.result);
      if (codeless !== null) cache.set(key, codeless);
      return codeless;
    } catch {
      return null;
    }
  };
}
