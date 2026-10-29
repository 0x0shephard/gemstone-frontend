import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SIWE_CLOCK_SKEW_MS,
  configuredChainId,
  isAnonymousUser,
  siweTimesValid,
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

describe('walletLinkTrustedOn', () => {
  it('trusts an EOA link on any chain', () => {
    expect(walletLinkTrustedOn({ chain_id: 11155111, signature_kind: 'eoa' }, 42161)).toBe(true);
  });

  it('trusts a contract link only on the chain it was proven on', () => {
    expect(walletLinkTrustedOn({ chain_id: 42161, signature_kind: 'contract' }, 42161)).toBe(true);
    expect(walletLinkTrustedOn({ chain_id: 11155111, signature_kind: 'contract' }, 42161)).toBe(
      false,
    );
  });

  it('treats a link with no recorded kind as a contract link', () => {
    expect(walletLinkTrustedOn({ chain_id: '42161', signature_kind: null }, 42161)).toBe(true);
    expect(walletLinkTrustedOn({ chain_id: 11155111 }, 42161)).toBe(false);
  });

  it('fails closed without a chain or a link', () => {
    expect(walletLinkTrustedOn({ chain_id: 42161, signature_kind: 'contract' }, null)).toBe(false);
    expect(walletLinkTrustedOn(null, 42161)).toBe(false);
  });

  it('is recorded by v1-siwe-verify and applied by the notification lookup', () => {
    const verify = source('supabase/functions/v1-siwe-verify/index.ts');
    expect(verify).toContain('signature_kind: signatureKind');
    expect(verify).toContain('recoverMessageAddress');
    const notify = source('supabase/functions/_shared/notify.ts');
    expect(notify).toContain(".select('profile_id,chain_id,signature_kind')");
    expect(notify.match(/walletLinkTrustedOn\(/g)?.length).toBe(2);
  });
});
