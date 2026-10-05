import { describe, expect, it } from 'vitest';
import { assertPickupCollector } from './pickupIdentity';

describe('pickup collector binding', () => {
  it('requires owner-supplied identity evidence and the owner profile identity', () => {
    expect(() =>
      assertPickupCollector({
        collectedByName: 'Arbitrary Person',
        proxyUsed: false,
        ownerProfileName: 'Verified Owner',
        ownerIdentityEvidenceOwned: true,
      }),
    ).toThrow('verified redemption owner');
    expect(() =>
      assertPickupCollector({
        collectedByName: 'Verified Owner',
        proxyUsed: false,
        ownerProfileName: 'Verified Owner',
        ownerIdentityEvidenceOwned: false,
      }),
    ).toThrow('verified redemption owner');
    expect(() =>
      assertPickupCollector({
        collectedByName: '  Verified   Owner ',
        proxyUsed: false,
        ownerProfileName: 'Verified Owner',
        ownerIdentityEvidenceOwned: true,
      }),
    ).not.toThrow();
  });

  it('requires the exact active proxy nomination name, wallet, and commitment', () => {
    const valid = {
      collectedByName: 'Proxy Person',
      proxyUsed: true,
      collectorWallet: '0x0000000000000000000000000000000000000002',
      collectorCommitment: '0xabc',
      nomination: {
        state: 'approved',
        proxyName: 'Proxy Person',
        proxyWallet: '0x0000000000000000000000000000000000000002',
        collectorCommitment: '0xabc',
      },
    };
    expect(() => assertPickupCollector(valid)).not.toThrow();
    expect(() => assertPickupCollector({ ...valid, collectorWallet: '0xdead' })).toThrow(
      'owner-authorized proxy',
    );
    expect(() =>
      assertPickupCollector({
        ...valid,
        nomination: { ...valid.nomination, state: 'revoked' },
      }),
    ).toThrow('owner-authorized proxy');
  });
});
