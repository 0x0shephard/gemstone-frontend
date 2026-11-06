import { QueryClient, type Query } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { describe, expect, it } from 'vitest';
import {
  advanceCountdowns,
  deserializeClient,
  serializeClient,
  shouldPersistQuery,
} from './queryPersistence';

const NOW = 1_800_000_000_000;

function persisted(data: unknown, dataUpdatedAt: number): PersistedClient {
  return {
    timestamp: dataUpdatedAt,
    buster: 'release:build',
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ['auctions'],
          queryHash: '["auctions"]',
          dehydratedAt: dataUpdatedAt,
          state: {
            data,
            dataUpdatedAt,
            dataUpdateCount: 1,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            fetchStatus: 'idle',
            isInvalidated: false,
            status: 'success',
          },
        },
      ],
    },
  };
}

function successfulQuery(queryKey: unknown[]): Query {
  const client = new QueryClient();
  client.setQueryData(queryKey, { ok: true });
  return client.getQueryCache().find({ queryKey }) as Query;
}

describe('query persistence', () => {
  it('round-trips bigints, including ones too large for a number', () => {
    const data = [{ floorUsd: 2363000000000000000000n, endTime: 1800000000n }];
    const restored = deserializeClient(serializeClient(persisted(data, NOW)), NOW);
    expect(restored.clientState.queries[0].state.data).toEqual(data);
  });

  it('moves countdowns on by the time since the chain was read', () => {
    const data = [{ gem: { id: 1n }, secondsLeft: 600, nested: [{ secondsLeft: 60 }] }];
    const written = serializeClient(persisted(data, NOW));
    const [query] = deserializeClient(written, NOW + 120_000).clientState.queries;
    expect(query.state.data).toEqual([
      { gem: { id: 1n }, secondsLeft: 480, nested: [{ secondsLeft: 0 }] },
    ]);
  });

  it('never restores an ended auction as live', () => {
    const written = serializeClient(persisted([{ secondsLeft: 3_600 }], NOW));
    const [query] = deserializeClient(written, NOW + 86_400_000).clientState.queries;
    expect(query.state.data).toEqual([{ secondsLeft: 0 }]);
  });

  it('leaves other numbers and missing data alone', () => {
    expect(advanceCountdowns({ carats: 3, secondsLeftLabel: 'soon' }, 100)).toEqual({
      carats: 3,
      secondsLeftLabel: 'soon',
    });
    expect(advanceCountdowns(undefined, 100)).toBeUndefined();
    expect(advanceCountdowns(null, 100)).toBeNull();
  });

  it('keeps catalogue and portfolio views', () => {
    for (const key of [['gems'], ['gem', '1'], ['auctions'], ['offers'], ['profile', '0xabc']]) {
      expect(shouldPersistQuery(successfulQuery(key)), key.join()).toBe(true);
    }
  });

  it('never stores money, safety state, or private off-chain data', () => {
    for (const key of [
      ['pendingRefunds', '0xabc'],
      ['pendingReserveCredits', '0xabc'],
      ['pendingTreasuryPayout', '0xabc'],
      ['paymentAssets'],
      ['bidPolicy'],
      ['redemptions'],
      ['redemptionWorkflows', 'profile-id'],
      ['kyc'],
    ]) {
      expect(shouldPersistQuery(successfulQuery(key)), key.join()).toBe(false);
    }
  });
});
