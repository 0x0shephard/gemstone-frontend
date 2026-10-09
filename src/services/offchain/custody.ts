import { supabase } from '@/providers/supabase';

/** What Digital Carat discloses publicly about who holds a tokenised stone. */
export interface PublicGemCustody {
  /** The vault custodian organization that recorded the stone's receipt. */
  custodianName?: string;
  vaultLocation?: string;
  /** Current custody agreement end, including any signed extension. */
  agreementEndsAt?: string;
  amended: boolean;
}

/** One bounded lookup; chain-only builds (no Supabase) disclose nothing. */
export async function publicGemCustody(gemIds: bigint[]): Promise<Map<string, PublicGemCustody>> {
  if (!supabase || gemIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('public_gem_custody', {
    gem_ids: gemIds.slice(0, 200).map((gemId) => gemId.toString()),
  });
  if (error) throw new Error(error.message);
  return new Map(
    (
      (data ?? []) as Array<{
        gem_id: string;
        custodian_name: string | null;
        vault_location: string | null;
        agreement_ends_at: string | null;
        amended: boolean | null;
      }>
    ).map((row) => [
      row.gem_id,
      {
        custodianName: row.custodian_name ?? undefined,
        vaultLocation: row.vault_location?.trim() || undefined,
        agreementEndsAt: row.agreement_ends_at ?? undefined,
        amended: Boolean(row.amended),
      },
    ]),
  );
}
