import { describe, expect, it } from 'vitest';
import { fmtUsdBaseUnits, usdFromBaseUnits } from './format';

const USD = 10n ** 18n;

describe('usdFromBaseUnits', () => {
  it('keeps cents that integer division would floor away', () => {
    // `Number(v / 10n ** 18n)` is integer division: this returned 3672.
    expect(usdFromBaseUnits(367_275n * 10n ** 16n)).toBe(3_672.75);
  });

  it('does not collapse sub-dollar amounts to zero', () => {
    expect(usdFromBaseUnits(USD / 2n)).toBe(0.5);
    expect(usdFromBaseUnits(1n)).toBeGreaterThan(0);
  });

  it('handles whole dollars exactly', () => {
    expect(usdFromBaseUnits(8_352n * USD)).toBe(8_352);
  });

  it('handles zero', () => {
    expect(usdFromBaseUnits(0n)).toBe(0);
  });
});

describe('fmtUsdBaseUnits', () => {
  it('formats a valuation past the 1e21 threshold', () => {
    // A `numeric` column above 1e21 arrives as an exponential string and used to
    // throw inside BigInt(), taking down the whole seller page.
    expect(fmtUsdBaseUnits('3672000000000000000000')).toBe('$3,672');
  });

  it('degrades to a dash rather than throwing on unusable input', () => {
    expect(fmtUsdBaseUnits('3.672e+21')).toBe('$3,672');
    expect(fmtUsdBaseUnits('not a number')).toBe('—');
    expect(fmtUsdBaseUnits(null)).toBe('—');
    expect(fmtUsdBaseUnits(undefined)).toBe('—');
  });

  it('accepts a bigint directly', () => {
    expect(fmtUsdBaseUnits(146_88n * 10n ** 16n)).toBe('$146.88');
  });
});
