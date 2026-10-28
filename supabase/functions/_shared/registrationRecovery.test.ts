import { describe, expect, it, vi } from 'vitest';
import type { OperatorChain } from './chain.ts';
import { findRegisteredGem, GEM_REGISTERED_TOPIC } from './registrationRecovery.ts';

const REGISTRY = '0x2C4F20f1288Ed0a313C84acb7580da8C53420233';
const SELLER = '0x1111111111111111111111111111111111111111';
const OPERATOR = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';

const word = (value: string | bigint) =>
  `0x${(typeof value === 'bigint' ? value.toString(16) : value.slice(2).toLowerCase()).padStart(64, '0')}`;

const registered = (gemId: bigint, blockNumber: bigint, seller = SELLER, custodian = OPERATOR) => ({
  blockNumber,
  topics: [GEM_REGISTERED_TOPIC, word(gemId), word(seller), word(custodian)],
});

/** A provider holding `logs` that rejects spans wider than `cap`, the way capped plans do. */
function chainWith(logs: ReturnType<typeof registered>[], cap = 1_000_000n) {
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
    if (toBlock - fromBlock + 1n > cap) {
      throw new Error(`You can make eth_getLogs requests with up to a ${cap} block range.`);
    }
    return logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
  });
  return { chain: { logsClient: { getLogs } } as unknown as OperatorChain, getLogs };
}

const search = (isMatch: (gemId: bigint) => Promise<boolean>) => ({
  registry: REGISTRY as `0x${string}`,
  seller: SELLER as `0x${string}`,
  custodian: OPERATOR as `0x${string}`,
  from: 1_000n,
  to: 400_000n,
  isMatch,
});

describe('findRegisteredGem', () => {
  it('finds the newest matching registration across a wide Arbitrum-sized range', async () => {
    const { chain, getLogs } = chainWith([
      registered(5n, 2_000n),
      registered(6n, 2_100n, OTHER),
      registered(7n, 300_000n),
    ]);
    const isMatch = vi.fn(async (gemId: bigint) => gemId !== 99n);
    await expect(findRegisteredGem(chain, search(isMatch))).resolves.toBe(7n);
    expect(isMatch).toHaveBeenCalledTimes(1);
    // A wide-range provider covers ~28 hours of Arbitrum blocks in a handful of calls.
    expect(getLogs.mock.calls.length).toBeLessThan(10);
  });

  it('ignores another seller or custodian and other events', async () => {
    const { chain } = chainWith([
      registered(6n, 2_100n, OTHER),
      registered(8n, 2_200n, SELLER, OTHER),
      { blockNumber: 2_300n, topics: [word('0x01'), word(9n), word(SELLER), word(OPERATOR)] },
    ]);
    await expect(
      findRegisteredGem(
        chain,
        search(async () => true),
      ),
    ).resolves.toBeUndefined();
  });

  it('only answers "not registered" after reading the whole range', async () => {
    const { chain } = chainWith([], 10n);
    // A 10-block provider cannot cover 399k blocks inside the budget.
    await expect(
      findRegisteredGem(chain, { ...search(async () => true), budgetMs: 50 }),
    ).rejects.toThrow(/retry before registering again/);
  });
});
