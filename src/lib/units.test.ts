import { describe, expect, it } from 'vitest';
import { ceilMulDiv, parseUsdInput, reserveFundingPercent, usdInputToBaseUnits } from './units';

describe('base-unit arithmetic', () => {
  it('rounds inverse quotes upward', () => {
    expect(ceilMulDiv(10n, 10n, 6n)).toBe(17n);
    expect(ceilMulDiv(10n, 10n, 5n)).toBe(20n);
  });

  it('parses USD without floating-point arithmetic', () => {
    expect(usdInputToBaseUnits('1250.25')).toBe(1_250_250_000_000_000_000_000n);
    expect(() => usdInputToBaseUnits('1.0000000000000000001')).toThrow();
  });

  it('caps reserve presentation at 100 percent', () => {
    expect(reserveFundingPercent(82n, 100n)).toBe(82);
    expect(reserveFundingPercent(120n, 100n)).toBe(100);
  });
});

describe('parseUsdInput', () => {
  /**
   * The regression this exists for. Money reached the chain via
   * `BigInt(Math.round(usd * 1e6)) * 10n ** 12n`, which snaps every amount to
   * the nearest millionth of a dollar — so smaller amounts vanished entirely,
   * and amounts between the steps were sent as a different figure than the one
   * the form displayed.
   */
  it('keeps amounts the old float round-trip destroyed', () => {
    // Rounded away to nothing: a cash leg the form showed but never sent.
    expect(parseUsdInput('0.0000004')).toBe(400_000_000_000n);
    expect(BigInt(Math.round(0.0000004 * 1e6)) * 10n ** 12n).toBe(0n);

    // Rounded up: a third more than was typed, taken from the payer.
    expect(parseUsdInput('0.0000015')).toBe(1_500_000_000_000n);
    expect(BigInt(Math.round(0.0000015 * 1e6)) * 10n ** 12n).toBe(2_000_000_000_000n);
  });

  it('returns null rather than a wrong number for malformed input', () => {
    for (const bad of ['', '   ', 'abc', '1,5', '-1', '1e6', '1.2.3', '.5']) {
      expect(parseUsdInput(bad)).toBeNull();
    }
  });

  it('tolerates whitespace around a pasted amount', () => {
    expect(parseUsdInput('  12.50  ')).toBe(12_500_000_000_000_000_000n);
  });

  it('rejects more than eighteen decimals rather than truncating', () => {
    expect(parseUsdInput('1.0000000000000000001')).toBeNull();
  });

  it('reads a trailing dot as the whole amount', () => {
    // `12.` is what a half-typed decimal looks like; treating it as 12 is
    // kinder than refusing, and cannot be mistaken for another figure.
    expect(parseUsdInput('12.')).toBe(12n * 10n ** 18n);
  });
});
