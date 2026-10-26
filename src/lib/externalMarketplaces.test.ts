import { describe, expect, it } from 'vitest';
import { openSeaItemUrl } from './externalMarketplaces';

const contract = '0x591bB1da8b80C773211301f7fa6f639617182a0d';

describe('openSeaItemUrl', () => {
  it('links a token on a chain OpenSea lists', () => {
    expect(openSeaItemUrl(42161, contract, 7n)).toBe(
      'https://opensea.io/item/arbitrum/0x591bb1da8b80c773211301f7fa6f639617182a0d/7',
    );
    expect(openSeaItemUrl(137, contract, 1n)).toContain('/item/polygon/');
  });

  it('offers no link on testnets, which OpenSea no longer lists', () => {
    expect(openSeaItemUrl(11155111, contract, 7n)).toBeUndefined();
    expect(openSeaItemUrl(31337, contract, 7n)).toBeUndefined();
  });
});
