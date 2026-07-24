import { describe, expect, it } from 'vitest';
import { ceilMulDiv, reserveFundingPercent, usdInputToBaseUnits } from './units';

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
