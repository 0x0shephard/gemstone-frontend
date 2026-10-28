import type { Address, Log } from 'npm:viem@2';
import type { OperatorChain } from './chain.ts';
import { scanLogs } from './logScan.ts';

/** keccak256("GemRegistered(uint256,address,address)"). */
export const GEM_REGISTERED_TOPIC =
  '0x9e5d876a2812831ebb97e576d8db3bd02cc3d6f3976af292af428e62fb5ff95a';

const topicAddress = (topic: string | undefined) =>
  topic ? `0x${topic.slice(-40)}`.toLowerCase() : undefined;

export interface RegistrationSearch {
  registry: Address;
  seller: Address;
  custodian: Address;
  from: bigint;
  to: bigint;
  /** Whether the registered gem is this submission's (metadata and certificate match). */
  isMatch: (gemId: bigint) => Promise<boolean>;
  budgetMs?: number;
}

/**
 * The gem id of an earlier registration of this submission, if one landed.
 *
 * `registerGem` is not idempotent and the registry has no uniqueness guard, so
 * "not found" makes the caller register the stone again. That answer is only
 * given after the whole range was read: a scan cut short by its budget throws,
 * and the activation is retried, rather than risk a second registration.
 *
 * Uses the adaptive scanner, so a wide-range provider covers hours of Arbitrum
 * blocks in a few calls where the old fixed 10-block walk needed thousands.
 */
export async function findRegisteredGem(
  chain: OperatorChain,
  search: RegistrationSearch,
): Promise<bigint | undefined> {
  const seller = search.seller.toLowerCase();
  const custodian = search.custodian.toLowerCase();
  const candidates: bigint[] = [];
  const result = await scanLogs(chain, {
    address: search.registry,
    from: search.from,
    to: search.to,
    budgetMs: search.budgetMs ?? 25_000,
    onLogs: (logs: Log[]) => {
      for (const log of logs) {
        const topics = log.topics as readonly string[];
        if (
          topics[0]?.toLowerCase() === GEM_REGISTERED_TOPIC &&
          topicAddress(topics[2]) === seller &&
          topicAddress(topics[3]) === custodian &&
          topics[1]
        ) {
          candidates.push(BigInt(topics[1]));
        }
      }
    },
  });
  if (!result.caughtUp) {
    throw new Error(
      `Registration recovery covered blocks ${search.from}-${result.scannedThrough} of ${search.to}; retry before registering again`,
    );
  }
  // Newest first: a retried submission's latest registration is the live one.
  for (const gemId of candidates.reverse()) {
    if (await search.isMatch(gemId)) return gemId;
  }
  return undefined;
}
