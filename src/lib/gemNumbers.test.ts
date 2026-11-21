import { describe, expect, it } from 'vitest';
import { gemTokenLabel, parseGemNumbers, resolveGemTokens } from './gemNumbers';

describe('parseGemNumbers', () => {
  it('reads DGE labels and bare numbers alike', () => {
    expect(parseGemNumbers('DGE-14, dge 15 16')).toEqual([14n, 15n, 16n]);
    expect(parseGemNumbers('DGE14\nDGE-015')).toEqual([14n, 15n]);
  });

  it('drops repeats and zero, keeping order', () => {
    expect(parseGemNumbers('15, DGE-14, 15, 0')).toEqual([15n, 14n]);
  });

  it('returns nothing for text without numbers', () => {
    expect(parseGemNumbers('DGE-')).toEqual([]);
  });
});

describe('gemTokenLabel', () => {
  it('names both numbers, or the token alone when the gem is unknown', () => {
    expect(gemTokenLabel('14', '10')).toBe('DGE-14 · token #10');
    expect(gemTokenLabel(null, '10')).toBe('token #10');
    expect(gemTokenLabel('0', 3n)).toBe('token #3');
  });
});

describe('resolveGemTokens', () => {
  it('reports unmintable gems per stone without failing the batch', async () => {
    const tokens = new Map([[14n, 10n]]);
    const result = await resolveGemTokens([14n, 10n], async (gemId) => {
      const tokenId = tokens.get(gemId);
      if (tokenId === undefined) throw new Error(`DGE-${gemId} has no token yet.`);
      return tokenId;
    });
    expect(result).toEqual([
      { gemId: 14n, tokenId: 10n },
      { gemId: 10n, problem: 'DGE-10 has no token yet.' },
    ]);
  });
});
