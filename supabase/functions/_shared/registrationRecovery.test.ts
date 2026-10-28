import { describe, expect, it, vi } from 'vitest';
import { encodeEventTopics, parseAbi, type Address } from 'viem';
import type { OperatorChain } from './chain.ts';
import { findRegisteredGem, GEM_REGISTERED_TOPIC } from './registrationRecovery.ts';

const REGISTRY = '0x2C4F20f1288Ed0a313C84acb7580da8C53420233' as Address;
const SELLER = '0x1111111111111111111111111111111111111111' as Address;
const OPERATOR = '0x2222222222222222222222222222222222222222' as Address;
const OTHER = '0x3333333333333333333333333333333333333333' as Address;

// Encoded from the contract's own event signature, independently of the module's constant.
const gemRegistryAbi = parseAbi([
  'event GemRegistered(uint256 indexed gemId, address indexed seller, address indexed custodian)',
]);

const registered = (gemId: bigint, blockNumber: bigint, seller = SELLER, custodian = OPERATOR) => ({
  blockNumber,
  topics: encodeEventTopics({
    abi: gemRegistryAbi,
    eventName: 'GemRegistered',
    args: { gemId, seller, custodian },
  }),
});

/** A provider holding `logs` that rejects spans wider than `cap`, the way capped plans do. */
function chainWith(
  logs: ReturnType<typeof registered>[],
  { cap = 1_000_000n, head = 400_000n } = {},
) {
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
    if (toBlock - fromBlock + 1n > cap) {
      throw new Error(`You can make eth_getLogs requests with up to a ${cap} block range.`);
    }
    return logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
  });
  const getBlockNumber = vi.fn(async () => head);
  return {
    chain: { logsClient: { getLogs, getBlockNumber } } as unknown as OperatorChain,
    getLogs,
  };
}

const search = (isMatch: (gemId: bigint) => Promise<boolean>) => ({
  registry: REGISTRY,
  seller: SELLER,
  custodian: OPERATOR,
  from: 1_000n,
  to: 400_000n,
  isMatch,
});

describe('findRegisteredGem', () => {
  it('matches the topic the contract emits', () => {
    expect(registered(1n, 1n).topics[0]).toBe(GEM_REGISTERED_TOPIC);
  });

  it('finds the newest matching registration across a wide Arbitrum-sized range', async () => {
    const { chain, getLogs } = chainWith([
      registered(5n, 2_000n),
      registered(6n, 2_100n, OTHER),
      registered(7n, 300_000n),
    ]);
    const isMatch = vi.fn(async () => true);
    await expect(findRegisteredGem(chain, search(isMatch))).resolves.toBe(7n);
    expect(isMatch).toHaveBeenCalledTimes(1);
    // A wide-range provider covers ~28 hours of Arbitrum blocks in a handful of calls.
    expect(getLogs.mock.calls.length).toBeLessThan(10);
  });

  it('reaches back to the first block of the range', async () => {
    const { chain, getLogs } = chainWith([registered(5n, 1_000n), registered(7n, 300_000n)]);
    // Only the earliest registration is this submission's.
    await expect(
      findRegisteredGem(
        chain,
        search(async (gemId) => gemId === 5n),
      ),
    ).resolves.toBe(5n);
    expect(getLogs.mock.calls[0][0].fromBlock).toBe(1_000n);
  });

  it('ignores another seller or custodian and other events', async () => {
    const other = registered(9n, 2_300n);
    const { chain } = chainWith([
      registered(6n, 2_100n, OTHER),
      registered(8n, 2_200n, SELLER, OTHER),
      {
        ...other,
        topics: [`0x${'01'.padStart(64, '0')}`, ...other.topics.slice(1)] as typeof other.topics,
      },
    ]);
    await expect(
      findRegisteredGem(
        chain,
        search(async () => true),
      ),
    ).resolves.toBeUndefined();
  });

  it('only answers "not registered" after reading the whole range', async () => {
    const { chain } = chainWith([], { cap: 10n });
    // A 10-block provider cannot cover 399k blocks inside the budget.
    await expect(
      findRegisteredGem(chain, { ...search(async () => true), budgetMs: 50 }),
    ).rejects.toThrow(/retry before registering again/);
  });

  it('refuses to answer from a logs node that has not reached the head yet', async () => {
    // The registration landed at 400,000 on the write node; the logs node is a block behind.
    const { chain, getLogs } = chainWith([registered(7n, 400_000n)], { head: 399_999n });
    await expect(
      findRegisteredGem(
        chain,
        search(async () => true),
      ),
    ).rejects.toThrow(/behind 400000/);
    expect(getLogs).not.toHaveBeenCalled();
  });
});
