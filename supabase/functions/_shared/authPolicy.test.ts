import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SIWE_CLOCK_SKEW_MS,
  codeIsCodeless,
  configuredChainId,
  isAnonymousUser,
  rpcCodelessCheck,
  siweTimesValid,
  walletLinkTrust,
  walletLinkTrustedOn,
} from './authPolicy.ts';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('isAnonymousUser', () => {
  it('flags anonymous sign-ins only', () => {
    expect(isAnonymousUser({ is_anonymous: true })).toBe(true);
    expect(isAnonymousUser({ is_anonymous: false })).toBe(false);
    // Users created before the field existed have no flag at all.
    expect(isAnonymousUser({})).toBe(false);
    expect(isAnonymousUser(null)).toBe(false);
  });

  it('is what requireUser refuses, with the same 401 message as a bad token', () => {
    const auth = source('supabase/functions/_shared/auth.ts');
    const requireUser = auth.slice(auth.indexOf('export async function requireUser'));
    expect(requireUser).toMatch(
      /if \(isAnonymousUser\(data\.user\)\) throw new Error\('Invalid session'\);/,
    );
    expect(requireUser.indexOf('isAnonymousUser')).toBeLessThan(
      requireUser.indexOf('return data.user'),
    );
  });
});

describe('configuredChainId', () => {
  it('accepts a positive integer', () => {
    expect(configuredChainId('42161')).toBe(42161);
    expect(configuredChainId(' 42161 ')).toBe(42161);
  });

  it('fails closed on anything else, with no Sepolia default', () => {
    for (const value of [undefined, null, '', '0', '-1', '42161.5', 'arbitrum', '0x a4b1']) {
      expect(configuredChainId(value), String(value)).toBeNull();
    }
  });

  it('is the only source of the chain in both SIWE functions', () => {
    for (const fn of ['v1-siwe-nonce', 'v1-siwe-verify']) {
      const code = source(`supabase/functions/${fn}/index.ts`);
      expect(code, fn).not.toMatch(/11155111/);
      expect(code, fn).toContain("configuredChainId(Deno.env.get('CHAIN_ID'))");
      expect(code, fn).toMatch(/expectedChain === null\)[\s\S]{0,200}503/);
    }
  });
});

describe('siweTimesValid', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  const later = (ms: number) => new Date(now.getTime() + ms);

  it('allows a wallet clock up to a minute fast', () => {
    expect(SIWE_CLOCK_SKEW_MS).toBe(60_000);
    expect(siweTimesValid({ issuedAt: later(5_000), expirationTime: later(600_000) }, now)).toBe(
      true,
    );
    expect(siweTimesValid({ issuedAt: later(60_000), expirationTime: later(600_000) }, now)).toBe(
      true,
    );
  });

  it('still refuses a clock further ahead than that', () => {
    expect(siweTimesValid({ issuedAt: later(60_001), expirationTime: later(600_000) }, now)).toBe(
      false,
    );
  });

  it('refuses expired, missing or invalid times', () => {
    expect(siweTimesValid({ issuedAt: later(-1_000), expirationTime: now }, now)).toBe(false);
    expect(siweTimesValid({ expirationTime: later(600_000) }, now)).toBe(false);
    expect(siweTimesValid({ issuedAt: later(-1_000) }, now)).toBe(false);
    expect(
      siweTimesValid({ issuedAt: new Date('nope'), expirationTime: later(600_000) }, now),
    ).toBe(false);
  });

  it('is what v1-siwe-verify checks instead of `issuedAt > now`', () => {
    const code = source('supabase/functions/v1-siwe-verify/index.ts');
    expect(code).toContain('!siweTimesValid(parsed, now)');
    expect(code).not.toMatch(/parsed\.issuedAt > now/);
  });
});

const ADDRESS = '0x1111111111111111111111111111111111111111';
const yes = async () => true;
const no = async () => false;
const unknown = async () => null;

describe('walletLinkTrust', () => {
  it('trusts an EOA link on any chain', () => {
    expect(walletLinkTrust({ chain_id: 11155111, signature_kind: 'eoa' }, 42161)).toBe('trusted');
  });

  it('trusts a contract link only on the chain it was proven on', () => {
    expect(walletLinkTrust({ chain_id: 42161, signature_kind: 'contract' }, 42161)).toBe('trusted');
    expect(walletLinkTrust({ chain_id: 11155111, signature_kind: 'contract' }, 42161)).toBe(
      'untrusted',
    );
  });

  it('leaves a legacy link from another chain to the code check', () => {
    expect(walletLinkTrust({ chain_id: '42161', signature_kind: null }, 42161)).toBe('trusted');
    expect(walletLinkTrust({ chain_id: 11155111, signature_kind: null }, 42161)).toBe('legacy');
    expect(walletLinkTrust({ chain_id: 11155111 }, 42161)).toBe('legacy');
  });

  it('fails closed without a chain or a link', () => {
    expect(walletLinkTrust({ chain_id: 42161, signature_kind: 'contract' }, null)).toBe(
      'untrusted',
    );
    expect(walletLinkTrust({ chain_id: 42161, signature_kind: null }, null)).toBe('untrusted');
    expect(walletLinkTrust(null, 42161)).toBe('untrusted');
  });
});

describe('walletLinkTrustedOn', () => {
  const legacy = { chain_id: 11155111, signature_kind: null };

  it('trusts a legacy link from another chain only when the address has no code here', async () => {
    await expect(walletLinkTrustedOn(legacy, 42161, ADDRESS, yes)).resolves.toBe(true);
    await expect(walletLinkTrustedOn(legacy, 42161, ADDRESS, no)).resolves.toBe(false);
  });

  it('does not trust it when the check cannot answer', async () => {
    await expect(walletLinkTrustedOn(legacy, 42161, ADDRESS, unknown)).resolves.toBe(false);
    await expect(walletLinkTrustedOn(legacy, 42161, ADDRESS, null)).resolves.toBe(false);
    const failing = async (): Promise<boolean | null> => {
      throw new Error('rpc down');
    };
    await expect(walletLinkTrustedOn(legacy, 42161, ADDRESS, failing)).resolves.toBe(false);
  });

  it('never calls the RPC for a link the row already decides', async () => {
    const check = vi.fn(yes);
    await walletLinkTrustedOn({ chain_id: 42161, signature_kind: null }, 42161, ADDRESS, check);
    await walletLinkTrustedOn({ chain_id: 1, signature_kind: 'eoa' }, 42161, ADDRESS, check);
    await expect(
      walletLinkTrustedOn({ chain_id: 1, signature_kind: 'contract' }, 42161, ADDRESS, check),
    ).resolves.toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('is recorded by v1-siwe-verify and applied by the notification lookup', () => {
    const verify = source('supabase/functions/v1-siwe-verify/index.ts');
    expect(verify).toContain('signature_kind: signatureKind');
    expect(verify).toContain('recoverMessageAddress');
    const notify = source('supabase/functions/_shared/notify.ts');
    expect(notify).toContain(".select('profile_id,chain_id,signature_kind')");
    expect(notify.match(/await walletLinkTrustedOn\(/g)?.length).toBe(2);
    expect(notify).toContain(
      "Deno.env.get('RPC_URL')?.trim() || Deno.env.get('SEPOLIA_RPC_URL')?.trim()",
    );
  });
});

describe('codeIsCodeless', () => {
  it('reads empty code and an EIP-7702 delegation as an EOA', () => {
    expect(codeIsCodeless('0x')).toBe(true);
    expect(codeIsCodeless(`0xef0100${'ab'.repeat(20)}`)).toBe(true);
  });

  it('reads deployed bytecode as a contract and junk as unknown', () => {
    expect(codeIsCodeless('0x6080604052')).toBe(false);
    expect(codeIsCodeless(`0xef0100${'ab'.repeat(21)}`)).toBe(false);
    expect(codeIsCodeless(undefined)).toBeNull();
    expect(codeIsCodeless('nope')).toBeNull();
  });
});

describe('rpcCodelessCheck', () => {
  const rpc = (result: unknown, status = 200) =>
    vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status }),
    );

  it('is unavailable without an RPC URL', () => {
    expect(rpcCodelessCheck(undefined)).toBeNull();
    expect(rpcCodelessCheck('  ')).toBeNull();
  });

  it('asks eth_getCode at latest and caches a definite answer', async () => {
    const fetcher = rpc('0x');
    const check = rpcCodelessCheck('https://arb.example/rpc', new Map(), fetcher)!;
    await expect(check(ADDRESS)).resolves.toBe(true);
    await expect(check(ADDRESS)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://arb.example/rpc');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: 'eth_getCode',
      params: [ADDRESS, 'latest'],
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a contract, and returns unknown (uncached) on RPC failure', async () => {
    const contract = rpcCodelessCheck('https://rpc', new Map(), rpc('0x6080'))!;
    await expect(contract(ADDRESS)).resolves.toBe(false);
    const cache = new Map<string, boolean>();
    await expect(rpcCodelessCheck('https://rpc', cache, rpc('0x', 500))!(ADDRESS)).resolves.toBe(
      null,
    );
    const throwing = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network');
    });
    await expect(rpcCodelessCheck('https://rpc', cache, throwing)!(ADDRESS)).resolves.toBeNull();
    expect(cache.size).toBe(0);
  });
});
