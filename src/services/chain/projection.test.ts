import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { scanLogs } from './projection';

/**
 * Stands in for an RPC provider that rejects `eth_getLogs` spans wider than its
 * documented cap, which is how public Sepolia endpoints behave.
 */
function cappedProvider(maxBlocks: bigint) {
  const attempts: bigint[] = [];
  const getLogs = vi.fn(
    async ({ fromBlock, toBlock }: { address?: string; fromBlock: bigint; toBlock: bigint }) => {
      const span = toBlock - fromBlock + 1n;
      attempts.push(span);
      if (span > maxBlocks) {
        throw new Error(
          `Log response size exceeded. Maximum allowed number of requested blocks is ${maxBlocks}`,
        );
      }
      return [];
    },
  );
  return { client: { getLogs } as unknown as PublicClient, attempts, getLogs };
}

const rejected = (attempts: bigint[], maxBlocks: bigint) =>
  attempts.filter((span) => span > maxBlocks).length;

describe('projection log scanning', () => {
  // Cap deliberately below INITIAL_RANGE so the scanner is forced to ratchet down
  // and the "grow back into a rejected width" regression is actually reachable.
  const maxBlocks = 500n;

  it('never re-probes a span the provider already rejected', async () => {
    const { client, attempts } = cappedProvider(maxBlocks);

    await scanLogs(client, 0n, 20_000n, 0n, {});

    // The first parallel address batch sees the same rejected range. After that
    // batch, the provider's advertised cap is honoured for the whole scan.
    expect(rejected(attempts, maxBlocks)).toBeGreaterThan(0);
    let finalRejection = -1;
    attempts.forEach((span, index) => {
      if (span > maxBlocks) finalRejection = index;
    });
    expect(attempts.slice(finalRejection + 1).every((span) => span <= maxBlocks)).toBe(true);
  });

  it('completes a scan without wasting more calls than it makes useful ones', async () => {
    const { client, attempts } = cappedProvider(maxBlocks);

    await scanLogs(client, 0n, 20_000n, 0n, {});

    const wasted = rejected(attempts, maxBlocks);
    expect(wasted).toBeLessThan(attempts.length - wasted);
  });

  it('covers the full range exactly once', async () => {
    const { client, getLogs } = cappedProvider(1_000n);

    await scanLogs(client, 100n, 5_100n, 0n, {});

    const accepted = getLogs.mock.calls
      .map(([query]) => query)
      .filter(({ toBlock, fromBlock }) => toBlock - fromBlock + 1n <= 1_000n);
    const byAddress = new Map<string | undefined, typeof accepted>();
    for (const query of accepted) {
      const queries = byAddress.get(query.address) ?? [];
      queries.push(query);
      byAddress.set(query.address, queries);
    }
    expect(byAddress.size).toBeGreaterThan(1);
    for (const queries of byAddress.values()) {
      expect(queries[0].fromBlock).toBe(100n);
      expect(queries.at(-1)?.toBlock).toBe(5_100n);
      // Contiguous, no gaps and no overlaps for every contract independently.
      queries.slice(1).forEach((query, index) => {
        expect(query.fromBlock).toBe(queries[index].toBlock + 1n);
      });
    }
  });

  it('uses a dedicated historical provider before the ordinary read client', async () => {
    const ordinary = cappedProvider(10n);
    const historical = cappedProvider(50_000n);

    await scanLogs(ordinary.client, 100n, 50_100n, 0n, {
      logClients: [historical.client],
    });

    expect(historical.getLogs).toHaveBeenCalled();
    expect(ordinary.getLogs).not.toHaveBeenCalled();
    expect(historical.getLogs.mock.calls.every(([query]) => !Array.isArray(query.address))).toBe(
      true,
    );
  });

  it('gives up instead of looping when even the minimum span is rejected', async () => {
    const { client } = cappedProvider(1n);

    await expect(scanLogs(client, 0n, 10_000n, 0n, {})).rejects.toThrow(/Log response size/);
  });

  it('honours an abort signal', async () => {
    const { client } = cappedProvider(1_000n);
    const controller = new AbortController();
    controller.abort();

    await expect(scanLogs(client, 0n, 10_000n, 0n, { signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
  });
});
