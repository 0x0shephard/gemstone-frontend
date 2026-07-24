import { formatUnits, type Address } from 'viem';
import { NATIVE_ASSET } from '@/config/contracts';
import type { ProjectedEvent } from './projection';

export interface AssetDescriptor {
  symbol: string;
  decimals: number;
}

export function describePaymentAsset(asset: Address, mockUsdc: Address): AssetDescriptor {
  if (asset === NATIVE_ASSET) return { symbol: 'ETH', decimals: 18 };
  if (asset.toLowerCase() === mockUsdc.toLowerCase()) return { symbol: 'mUSDC', decimals: 6 };
  return { symbol: 'token', decimals: 18 };
}

export function formatSwapCash(
  amount: bigint,
  usdValue: bigint,
  descriptor: AssetDescriptor,
  proposerPays: boolean,
): string {
  if (amount === 0n) return 'No cash delta';
  return `${proposerPays ? 'Proposer pays' : 'Accepter pays'} ${formatUnits(
    amount,
    descriptor.decimals,
  )} ${descriptor.symbol} ($${Number(formatUnits(usdValue, 18)).toLocaleString()})`;
}

export function latestBidEventsForAddress(
  events: ProjectedEvent[],
  address?: string,
): ProjectedEvent[] {
  if (!address) return [];
  const normalized = address.toLowerCase();
  const latestByGem = new Map<string, ProjectedEvent>();
  for (const event of events) {
    if (
      event.module !== 'PrimarySaleAuction' ||
      event.eventName !== 'BidPlaced' ||
      typeof event.args.bidder !== 'string' ||
      event.args.bidder.toLowerCase() !== normalized ||
      typeof event.args.gemId !== 'bigint'
    ) {
      continue;
    }
    latestByGem.set(String(event.args.gemId), event);
  }
  return [...latestByGem.values()];
}
