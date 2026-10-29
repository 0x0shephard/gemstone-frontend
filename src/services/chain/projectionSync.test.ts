import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';

/*
 * `syncProjection` needs a deployment manifest; CI has no `.env`, so a
 * synthetic one stands in. Addresses only need to be distinct.
 */
vi.mock('@/config/contracts', () => {
  const modules = [
    'DGENFT',
    'GemRegistry',
    'PaymentTokenRegistry',
    'ReserveManager',
    'Treasury',
    'PrimarySaleAuction',
    'Marketplace',
    'SwapEscrow',
    'RedemptionManager',
    'ComplianceRegistry',
  ] as const;
  const addresses = Object.fromEntries(
    modules.map((name, index) => [name, `0x${(index + 1).toString(16).padStart(40, '0')}`]),
  );
  const manifest = {
    schemaVersion: 1 as const,
    chainId: 42161,
    deploymentBlock: 1_000n,
    addresses,
    nativeAsset: '0x0000000000000000000000000000000000000000',
  };
  return {
    contractModules: modules,
    contractAddresses: addresses,
    deploymentManifestHash: `0x${'ab'.repeat(32)}`,
    requireDeploymentManifest: () => manifest,
  };
});

import {
  INITIAL_RANGE,
  MAX_RANGE,
  fallbackConfirmations,
  finalizedBlock,
  isRangeRejection,
  scanLogs,
  syncProjection,
  type PersistedMeta,
  type ProjectedEvent,
  type ProjectionCache,
} from './projection';

const CONTRACTS = 10n;

/** A provider that accepts any span, recording each request's width. */
function permissiveProvider() {
  const spans: bigint[] = [];
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
    spans.push(toBlock - fromBlock + 1n);
    return [];
  });
  return { client: { getLogs } as unknown as PublicClient, spans, getLogs };
}

describe('projection window growth', () => {
  it('widens past the initial window when the provider accepts wide ranges', async () => {
    const { client, spans } = permissiveProvider();

    // About a month of Arbitrum blocks.
    await scanLogs(client, 0n, 10_000_000n, 0n, {});

    expect(spans.some((span) => span > INITIAL_RANGE)).toBe(true);
    expect(spans.every((span) => span <= MAX_RANGE)).toBe(true);
    // 50k, 100k, …, 6.4M covers 10M blocks in eight windows per contract,
    // instead of the 200 a fixed 50k window needed.
    expect(BigInt(spans.length)).toBeLessThanOrEqual(8n * CONTRACTS);
  });

  it('recovers its width after a burst of rate limiting instead of halving for good', async () => {
    vi.useFakeTimers();
    try {
      let failures = 0;
      const spans: bigint[] = [];
      const getLogs = vi.fn(
        async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
          // Three rejected rounds, then the provider is healthy again.
          if (fromBlock === 0n && failures < 3 * Number(CONTRACTS)) {
            failures += 1;
            throw new Error('429 Too Many Requests: compute units per second exceeded');
          }
          spans.push(toBlock - fromBlock + 1n);
          return [];
        },
      );
      const scan = scanLogs({ getLogs } as unknown as PublicClient, 0n, 5_000_000n, 0n, {});
      await vi.runAllTimersAsync();
      await scan;

      // Rate limiting is not a size limit: the window grows back past the
      // initial width once requests succeed.
      expect(spans.at(-1)! > INITIAL_RANGE).toBe(true);
      expect(spans.some((span) => span >= 4n * INITIAL_RANGE)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after repeated transient failures rather than retrying forever', async () => {
    vi.useFakeTimers();
    try {
      const getLogs = vi.fn(async () => {
        throw new Error('request timed out');
      });
      const scan = scanLogs({ getLogs } as unknown as PublicClient, 0n, 1_000_000n, 0n, {});
      const outcome = expect(scan).rejects.toThrow(/timed out/);
      await vi.runAllTimersAsync();
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells a size rejection apart from a transient failure', () => {
    expect(isRangeRejection(new Error('query exceeds maximum block range: 2000'))).toBe(true);
    expect(isRangeRejection(new Error('query returned more than 10000 results'))).toBe(true);
    expect(isRangeRejection(new Error('Log response size exceeded.'))).toBe(true);
    expect(isRangeRejection(new Error('429 Too Many Requests'))).toBe(false);
    expect(isRangeRejection(new Error('request timed out'))).toBe(false);
    expect(isRangeRejection(new Error('fetch failed'))).toBe(false);
  });
});

describe('finality', () => {
  it("uses the chain's own finalized block when the RPC reports one", async () => {
    const getBlock = vi.fn(async () => ({ number: 900n }));
    await expect(finalizedBlock({ getBlock } as never, 1_000n, 42161)).resolves.toBe(900n);
    expect(getBlock).toHaveBeenCalledWith({ blockTag: 'finalized' });
  });

  it('falls back to an Arbitrum-sized margin, not twelve blocks, without the tag', async () => {
    const getBlock = vi.fn(async () => {
      throw new Error('unsupported block tag');
    });
    // Twelve 0.25 s blocks is three seconds; the fallback is ~20 minutes.
    expect(fallbackConfirmations(42161)).toBeGreaterThanOrEqual(4_000n);
    await expect(finalizedBlock({ getBlock } as never, 100_000n, 42161)).resolves.toBe(
      100_000n - fallbackConfirmations(42161),
    );
    await expect(finalizedBlock({ getBlock } as never, 10n, 42161)).resolves.toBe(0n);
  });
});

describe('warm sync checkpoints', () => {
  let store: { events: ProjectedEvent[]; meta?: PersistedMeta };
  let writes: PersistedMeta[];
  let cache: ProjectionCache;

  beforeEach(() => {
    writes = [];
    // A cache warmed by an earlier visit through block 2,000.
    store = { events: [], meta: { key: 'meta', scannedThrough: '2000', latestBlock: '2000' } };
    cache = {
      read: async () => ({ events: [...store.events], meta: store.meta }),
      replaceRange: async (fromBlock, events, meta) => {
        store.events = [
          ...store.events.filter((event) => event.blockNumber < fromBlock),
          ...events,
        ];
        store.meta = meta;
        writes.push(meta);
      },
      reset: async () => {
        store = { events: [] };
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checkpoints each chunk of a warm sync, so a failure keeps the progress made', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = {
      getBlockNumber: async () => 3_000_000n,
      getBlock: async () => ({ number: 2_990_000n }),
      getLogs: vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => {
        calls += 1;
        // The provider dies for good once the first windows have succeeded.
        if (fromBlock > 500_000n) throw new Error('fetch failed');
        return [];
      }),
    } as unknown as PublicClient;

    const sync = syncProjection(client, { cache });
    await vi.runAllTimersAsync();
    const snapshot = await sync;

    expect(calls).toBeGreaterThan(0);
    // Progress was written during the scan, not only at the end.
    expect(writes.length).toBeGreaterThan(0);
    const reached = BigInt(store.meta!.scannedThrough);
    expect(reached).toBeGreaterThan(2_000n);
    expect(reached).toBeLessThan(3_000_000n);
    expect(snapshot.status).toMatchObject({ partiallySynced: true, scannedThrough: reached });
  });

  it('records the full range once a warm sync completes', async () => {
    const client = {
      getBlockNumber: async () => 300_000n,
      getBlock: async () => ({ number: 299_000n }),
      getLogs: vi.fn(async () => []),
    } as unknown as PublicClient;

    const snapshot = await syncProjection(client, { cache });

    expect(store.meta?.scannedThrough).toBe('300000');
    expect(snapshot.status).toMatchObject({
      partiallySynced: false,
      scannedThrough: 300_000n,
      finalizedThrough: 299_000n,
    });
    // Intermediate checkpoints plus the final write.
    expect(writes.length).toBeGreaterThan(1);
  });
});
