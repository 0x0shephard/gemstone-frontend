import type { Address } from 'viem';
import { supabase } from '@/providers/supabase';
import type { DecoratedGem } from '@/services/types';

export interface MarketplaceParticipant {
  address: Address;
  role: 'Owner' | 'Seller';
}

/** The human participant behind a card, not the Marketplace escrow contract. */
export function marketplaceParticipant(gem: DecoratedGem): MarketplaceParticipant | undefined {
  if (gem.listingSeller) return { address: gem.listingSeller, role: 'Seller' };
  if (gem.owner) return { address: gem.owner, role: 'Owner' };
  if (gem.seller) return { address: gem.seller, role: 'Seller' };
  return undefined;
}

/** Resolve account names in one bounded request; chain-only mode keeps addresses. */
export async function marketplaceProfileNames(
  addresses: Address[],
): Promise<Record<string, string>> {
  if (!supabase || addresses.length === 0) return {};
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 100);
  const { data, error } = await supabase.rpc('marketplace_profile_names', {
    wallet_addresses: unique,
  });
  if (error) throw new Error(error.message);
  return Object.fromEntries(
    ((data ?? []) as Array<{ wallet_address: string; full_name: string }>).map((row) => [
      row.wallet_address.toLowerCase(),
      row.full_name,
    ]),
  );
}
