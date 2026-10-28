import { describe, expect, it } from 'vitest';
import { blocksBack, blocksForSeconds } from './blockTime.ts';

const WEEK = 7 * 24 * 60 * 60;

describe('blocksForSeconds', () => {
  it('keeps the Sepolia week near the 50,000 blocks it replaced', () => {
    expect(blocksForSeconds(11155111, WEEK)).toBe(50_400n);
  });

  it('covers the same week on Arbitrum, 48 times as many blocks', () => {
    expect(blocksForSeconds(42161, WEEK)).toBe(2_419_200n);
  });

  it('assumes fast blocks on an unknown chain so a window is never too short', () => {
    expect(blocksForSeconds(999_999, 60)).toBe(240n);
  });
});

describe('blocksBack', () => {
  it('stops at the deployment block and at zero', () => {
    expect(blocksBack(1_000n, 100n, 0n)).toBe(900n);
    expect(blocksBack(1_000n, 100n, 950n)).toBe(950n);
    expect(blocksBack(50n, 100n, 0n)).toBe(0n);
  });
});
