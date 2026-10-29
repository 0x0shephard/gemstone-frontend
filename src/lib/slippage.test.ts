import { describe, expect, it } from 'vitest';
import {
  bidWithinHeadroom,
  headroomPercent,
  PURCHASE_SLIPPAGE_BPS,
  suggestedBidUsd,
  usdInputString,
  withPurchaseHeadroom,
} from './slippage';
import { parseUsdInput } from './units';
import { assetAmountPreview } from '@/components/modals/parts';
import type { PaymentAsset } from '@/services/types';

const usd = (value: number) => BigInt(value) * 10n ** 18n;

describe('purchase headroom', () => {
  it('adds 0.5% to the quote, rounded up so it never falls short', () => {
    expect(withPurchaseHeadroom(1_050_000_000n)).toBe(1_055_250_000n);
    // 0.5% of 1 base unit rounds up to 1 rather than vanishing.
    expect(withPurchaseHeadroom(1n)).toBe(2n);
    expect(withPurchaseHeadroom(0n)).toBe(0n);
    expect(headroomPercent(PURCHASE_SLIPPAGE_BPS)).toBe('0.5%');
  });
});

describe('bid headroom', () => {
  it('suggests the minimum plus 0.5%, rounded up to a whole cent', () => {
    expect(suggestedBidUsd(usd(1_000))).toBe(usd(1_005));
    // $1,001 + 0.5% = $1,006.005 → $1,006.01.
    expect(suggestedBidUsd(usd(1_001))).toBe(1_006_010_000_000_000_000_000n);
    expect(suggestedBidUsd(0n)).toBe(0n);
  });

  it('round-trips the suggestion through the bid field exactly', () => {
    const suggestion = suggestedBidUsd(usd(1_001));
    expect(usdInputString(suggestion)).toBe('1006.01');
    expect(parseUsdInput(usdInputString(suggestion))).toBe(suggestion);
    expect(usdInputString(usd(1_005))).toBe('1005');
  });

  it('flags only bids between the minimum and the suggestion as tight', () => {
    const minimum = usd(1_000);
    expect(bidWithinHeadroom(minimum, minimum)).toBe(true);
    expect(bidWithinHeadroom(usd(1_004), minimum)).toBe(true);
    expect(bidWithinHeadroom(usd(1_005), minimum)).toBe(false);
    // Below the minimum is an error, not a warning.
    expect(bidWithinHeadroom(usd(999), minimum)).toBe(false);
  });
});

describe('asset amount preview', () => {
  const eth: PaymentAsset = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    usdPrice: 2_000,
    enabled: true,
    isNative: true,
  };

  it('never divides by an unread price', () => {
    expect(assetAmountPreview(1_000, { ...eth, usdPrice: 0 })).toBe(
      'ETH price unavailable · quoted when you confirm',
    );
    expect(assetAmountPreview(1_000, { ...eth, usdPrice: 0 })).not.toMatch(/∞|NaN/);
    expect(assetAmountPreview(1_000, eth)).toBe('≈ 0.5 ETH');
  });
});
