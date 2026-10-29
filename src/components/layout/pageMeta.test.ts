import { describe, expect, it } from 'vitest';
import { metaForPath, OPS_ROUTE_CAPABILITY } from './pageMeta';
import { resolveGiftOperator } from '@/config/contracts';

describe('page header titles', () => {
  it.each(Object.keys(OPS_ROUTE_CAPABILITY))(
    'does not reveal the hidden %s route to a non-member',
    (path) => {
      expect(metaForPath(path, 'denied')).toEqual({ title: 'Page not found', subtitle: '' });
      // While access is being checked the header names nothing at all.
      expect(metaForPath(path, 'pending').title).toBe('Digital Carat');
      expect(metaForPath(path).title).toBe('Page not found');
    },
  );

  it('shows the real title to a member and leaves public routes alone', () => {
    expect(metaForPath('/verify', 'granted').title).toBe('Operations admin');
    expect(metaForPath('/auctions', 'denied').title).toBe('Auctions');
    expect(metaForPath('/gem/12').title).toBe('Gem detail');
  });
});

describe('gift operator source', () => {
  const manifestOperator = '0x89c2c9fA2711Fef55C55a07fd2A7A3bb81505D53';
  const staleEnv = '0xcc62000000000000000000000000000000000001';

  it('takes the embedded release manifest over a stale environment value', () => {
    expect(resolveGiftOperator({ giftOperator: manifestOperator }, staleEnv)).toBe(
      manifestOperator,
    );
  });

  it('ignores the environment entirely once a manifest is embedded', () => {
    expect(resolveGiftOperator({}, staleEnv)).toBeUndefined();
  });

  it('reads the environment only for builds without a release manifest', () => {
    expect(resolveGiftOperator(null, staleEnv)?.toLowerCase()).toBe(staleEnv);
    expect(resolveGiftOperator(null, 'not-an-address')).toBeUndefined();
  });
});
