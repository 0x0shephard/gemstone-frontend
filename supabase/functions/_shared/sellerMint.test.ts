import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIMARY_SALE_MODE,
  requestedSaleMode,
  saleModeCode,
  sellerMintSwitchBlocker,
} from './sellerMintRules';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const ZERO = '0x0000000000000000000000000000000000000000';
const BIDDER = '0x5f8DB7637281C6D614ea4344d21752d5BA96d3E2';

describe('seller mint rules', () => {
  it('encodes sale modes as GemRegistry ordinals, SellerMint last', () => {
    expect(saleModeCode('buy_now')).toBe(1);
    expect(saleModeCode('auction')).toBe(2);
    expect(saleModeCode('seller_mint')).toBe(3);
    expect(PRIMARY_SALE_MODE.sellerMint).toBe(3);
  });

  it('lets a seller choose auction or minting, never buy-now', () => {
    expect(requestedSaleMode('seller_mint')).toBe('seller_mint');
    expect(requestedSaleMode('auction')).toBe('auction');
    expect(requestedSaleMode('buy_now')).toBe('auction');
    expect(requestedSaleMode(undefined)).toBe('auction');
  });

  const auction = (over: Partial<{ endTime: bigint; highestBidder: string }> = {}) => ({
    exists: true,
    settled: false,
    endTime: 1_000n,
    highestBidder: ZERO,
    ...over,
  });

  it('blocks the switch while anyone leads the auction', () => {
    expect(
      sellerMintSwitchBlocker({
        auction: auction({ highestBidder: BIDDER, endTime: 500n }),
        nowSeconds: 900n,
        reopenedRounds: 3,
      }),
    ).toMatch(/live bid/);
  });

  it('blocks the switch during the first round, before it ends unbid', () => {
    expect(
      sellerMintSwitchBlocker({ auction: auction(), nowSeconds: 900n, reopenedRounds: 0 }),
    ).toMatch(/first auction round/);
  });

  it('allows the switch once a round has ended without a bid', () => {
    // The current round is past its end with no leader.
    expect(
      sellerMintSwitchBlocker({ auction: auction(), nowSeconds: 1_000n, reopenedRounds: 0 }),
    ).toBeNull();
    // Or the sweep has already reopened it, and nobody leads the reopened round.
    expect(
      sellerMintSwitchBlocker({ auction: auction(), nowSeconds: 900n, reopenedRounds: 1 }),
    ).toBeNull();
    // Or no auction is open at all.
    expect(
      sellerMintSwitchBlocker({
        auction: { exists: false, settled: false, endTime: 0n, highestBidder: ZERO },
        nowSeconds: 900n,
        reopenedRounds: 0,
      }),
    ).toBeNull();
  });
});

describe('seller mint wiring', () => {
  const automation = source('supabase/functions/_shared/sellerAutomation.ts');
  const mint = automation.slice(
    automation.indexOf('async function mintSellerGem'),
    automation.indexOf('export class SellerMintSwitchRefused'),
  );
  const switcher = automation.slice(
    automation.indexOf('export async function switchSubmissionToSellerMint'),
    automation.indexOf('export async function syncSellerMint'),
  );

  it('lists in the chosen mode and mints at activation for seller_mint', () => {
    expect(automation).toContain('args: [gemId, priceUsd, saleModeCode(submission.sale_mode)]');
    expect(automation).toContain("if (submission.sale_mode === 'seller_mint')");
  });

  it('records an existing mint instead of minting twice, and only mints when nothing is due', () => {
    expect(mint.indexOf('gem.tokenId > 0n')).toBeLessThan(
      mint.indexOf("functionName: 'mintToSeller'"),
    );
    expect(mint.indexOf('sellerMintDueUsd')).toBeLessThan(
      mint.indexOf("functionName: 'mintToSeller'"),
    );
    expect(mint).toContain("activation_state: 'awaiting_seller_mint'");
    expect(mint).toContain('args: [gemId, ZERO_ADDRESS, 0n]');
    // Persisted at broadcast, like registration, so a lost receipt is recoverable.
    expect(mint).toContain('onSubmitted: async (submitted)');
    expect(mint).toContain('mint_tx_hash: submitted');
  });

  it('switches in order: refuse a blocked stone, cancel the stale round, set the mode, mint', () => {
    const blocker = switcher.indexOf('sellerMintSwitchBlocker(');
    const cancel = switcher.indexOf("functionName: 'cancelAuction'");
    const setMode = switcher.indexOf("functionName: 'setPrimarySaleMode'");
    const minted = switcher.indexOf('mintSellerGem(');
    expect(blocker).toBeGreaterThan(-1);
    expect(blocker).toBeLessThan(cancel);
    expect(cancel).toBeLessThan(setMode);
    expect(setMode).toBeLessThan(minted);
    expect(switcher).toContain('if (submission.seller_id !== sellerId)');
    expect(switcher).toContain('releaseSharedOperatorLease');
  });

  it('accepts the route at submission without ever allowing buy-now', () => {
    const submit = source('supabase/functions/v1-seller-submit/index.ts');
    expect(submit).toContain('const saleMode = requestedSaleMode(body.saleMode);');
    expect(submit).toContain("body.action === 'switch_to_mint'");
    expect(submit).toContain('SellerMintSwitchRefused');
  });

  it('allows the new sale mode and activation states in the database', () => {
    const migration = source('supabase/migrations/202610300401_seller_mint.sql');
    expect(migration).toContain("sale_mode in ('buy_now', 'auction', 'seller_mint')");
    expect(migration).toContain("'awaiting_seller_mint'");
    expect(migration).toContain("'minted'");
  });
});
