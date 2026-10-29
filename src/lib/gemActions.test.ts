import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import type { Auction, Gem, SwapRequest } from '@/services/types';
import { gemPageMode, listingAuctionState, type GemPageContext } from './gemActions';

const VIEWER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const MARKETPLACE = '0x3333333333333333333333333333333333333333' as Address;
const SWAP_ESCROW = '0x4444444444444444444444444444444444444444' as Address;
const NOW = 1_800_000_000n;

const custody = { marketplace: MARKETPLACE, swapEscrow: SWAP_ESCROW };
const context = (overrides: Partial<GemPageContext> = {}): GemPageContext => ({
  viewer: VIEWER,
  custody,
  now: NOW,
  ...overrides,
});

const unminted = { gemId: 5n } as Gem;
const auction = (overrides: Partial<Auction>): Auction =>
  ({
    settled: false,
    startTime: NOW - 3_600n,
    endTime: NOW + 3_600n,
    floorUsd: 1n,
    ...overrides,
  }) as Auction;
const token = (overrides: Partial<Gem>): Gem =>
  ({ gemId: 6n, tokenId: 9n, owner: OTHER, ...overrides }) as Gem;

describe('gem page actions for an unminted stone', () => {
  it('offers a bid only while an auction is open', () => {
    expect(gemPageMode(unminted, context({ auction: auction({}) })).kind).toBe('primary-bid');
    expect(
      gemPageMode(unminted, context({ auction: auction({ startTime: NOW + 60n }) })).kind,
    ).toBe('primary-upcoming');
  });

  it('never offers a bid when there is no auction, or while auctions are loading', () => {
    expect(gemPageMode(unminted, context())).toEqual({
      kind: 'primary-unavailable',
      loading: false,
    });
    expect(gemPageMode(unminted, context({ auctionsLoading: true }))).toEqual({
      kind: 'primary-unavailable',
      loading: true,
    });
    // A settled auction that refunded its winner leaves an unminted stone.
    expect(gemPageMode(unminted, context({ auction: auction({ settled: true }) })).kind).toBe(
      'primary-unavailable',
    );
  });

  it('offers settlement once an auction has ended with a winner, and nothing without one', () => {
    const ended = { startTime: NOW - 90_000n, endTime: NOW - 1n };
    expect(
      gemPageMode(unminted, context({ auction: auction({ ...ended, highestBidder: OTHER }) })).kind,
    ).toBe('primary-settle');
    expect(gemPageMode(unminted, context({ auction: auction(ended) })).kind).toBe('primary-unsold');
    // The end second itself is closed: `bid` reverts AuctionEnded at endTime.
    expect(
      gemPageMode(unminted, context({ auction: auction({ endTime: NOW, highestBidder: OTHER }) }))
        .kind,
    ).toBe('primary-settle');
  });
});

describe('gem page actions for a listed token', () => {
  const listed = (overrides: Partial<Gem> = {}) =>
    token({ owner: MARKETPLACE, listingSeller: OTHER, ...overrides });

  it('lets anyone buy or bid until a bid starts the auction', () => {
    expect(gemPageMode(listed(), context())).toEqual({ kind: 'listing', listingAuction: 'none' });
    expect(
      gemPageMode(listed({ listingWinningOfferId: 3n, listingAuctionEnd: NOW + 60n }), context()),
    ).toEqual({ kind: 'listing', listingAuction: 'live' });
  });

  it('stops offering bids after the listing auction ends and offers settlement instead', () => {
    const ended = listed({ listingWinningOfferId: 3n, listingAuctionEnd: NOW });
    expect(gemPageMode(ended, context())).toEqual({ kind: 'listing', listingAuction: 'ended' });
    expect(listingAuctionState(ended, NOW - 1n)).toBe('live');
  });

  it('gives the seller the listing controls, including settlement once ended', () => {
    const own = listed({ listingSeller: VIEWER, listingWinningOfferId: 3n, listingAuctionEnd: 1n });
    expect(gemPageMode(own, context())).toEqual({ kind: 'owner-listing', listingAuction: 'ended' });
  });
});

describe('gem page ownership', () => {
  it('requires actual ownership for owner actions, whatever the link said', () => {
    // A stranger following a `?manage=1` portfolio link.
    expect(gemPageMode(token({ owner: OTHER }), context()).kind).toBe('held');
    expect(gemPageMode(token({ owner: VIEWER }), context()).kind).toBe('owner-wallet');
    expect(gemPageMode(token({ owner: VIEWER }), context({ viewer: undefined })).kind).toBe('held');
  });

  it("offers the proposer their swap's cancel for a token SwapEscrow holds, not List or Send", () => {
    const escrowed = token({ owner: SWAP_ESCROW });
    const swap = {
      offerId: 4n,
      offeredTokenId: 9n,
      proposer: VIEWER,
      status: 'Expired',
    } as SwapRequest;

    expect(gemPageMode(escrowed, context({ swaps: [swap] }))).toEqual({
      kind: 'owner-swap-escrow',
      swap,
    });
    // Anyone else sees an escrowed token that cannot take offers.
    expect(gemPageMode(escrowed, context({ viewer: OTHER, swaps: [swap] })).kind).toBe('escrowed');
    // A finished swap no longer makes the viewer its owner.
    expect(gemPageMode(escrowed, context({ swaps: [{ ...swap, status: 'Accepted' }] })).kind).toBe(
      'escrowed',
    );
  });

  it('locks every action while a redemption is open, remembering who owns it', () => {
    expect(gemPageMode(token({ owner: VIEWER, transferLocked: true }), context())).toEqual({
      kind: 'locked',
      owner: true,
    });
    expect(gemPageMode(token({ transferLocked: true }), context())).toEqual({
      kind: 'locked',
      owner: false,
    });
  });
});
