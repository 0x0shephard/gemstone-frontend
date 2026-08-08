import { invokeEdgeFunction, requireClient } from './invoke';
import type { GiftTemplate } from '@/components/gift/GiftCardArt';

export type GiftCardState = 'active' | 'claimed' | 'cancelled' | 'expired';

export interface GiftCardRow {
  id: string;
  token_id: string;
  gem_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  message: string | null;
  template: GiftTemplate;
  status: 'active' | 'claimed' | 'cancelled';
  claimed_wallet: string | null;
  claimed_at: string | null;
  claim_tx_hash: string | null;
  expires_at: string;
  created_at: string;
}

export interface CreatedGiftCard {
  giftId: string;
  /** The only time this is ever readable — it is stored hashed. */
  code: string;
  displayCode: string;
  expiresAt: string;
  tokenId: string;
  gemId: string;
}

export interface GiftCardSummary {
  state: GiftCardState;
  tokenId: string;
  gemId: string | null;
  senderName: string;
  recipientName: string | null;
  recipientEmailMasked: string;
  message: string | null;
  template: GiftTemplate;
  expiresAt: string;
  createdAt: string;
  transactionHash?: string;
  recipientWallet?: string;
}

export function createGiftCard(input: {
  tokenId: bigint;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  template: GiftTemplate;
}): Promise<CreatedGiftCard> {
  return invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', {
    ...input,
    tokenId: input.tokenId.toString(),
  });
}

export function inspectGiftCard(code: string): Promise<GiftCardSummary> {
  return invokeEdgeFunction<GiftCardSummary>('v1-gift-claim', { action: 'inspect', code });
}

export function claimGiftCard(code: string): Promise<GiftCardSummary> {
  return invokeEdgeFunction<GiftCardSummary>('v1-gift-claim', { action: 'claim', code });
}

export function cancelGiftCard(giftId: string): Promise<{ giftId: string; tokenId: string }> {
  return invokeEdgeFunction('v1-gift-cancel', { giftId });
}

/**
 * The sender's own cards, read straight through RLS rather than an endpoint —
 * `gift_cards_read_own` already scopes this to `auth.uid()`, and there is
 * nothing here a function would add.
 */
export async function listGiftCards(): Promise<GiftCardRow[]> {
  const { data, error } = await requireClient()
    .from('gift_cards')
    // Numerics come back from PostgREST unquoted, and anything at or above 1e21
    // stringifies in exponential form — which `BigInt` then refuses. Casting in
    // the query keeps ids exact however large they get.
    .select(
      'id,token_id::text,gem_id::text,recipient_email,recipient_name,message,template,status,claimed_wallet,claimed_at,claim_tx_hash,expires_at,created_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GiftCardRow[];
}

/**
 * Display state for a stored row.
 *
 * Expiry is a timestamp, never a stored status: no job sets it, because the
 * operator cannot revoke its own per-token approval and so a sweep would have
 * nothing to do. The claim endpoint derives it the same way.
 */
export function giftCardState(card: GiftCardRow): GiftCardState {
  if (card.status !== 'active') return card.status;
  return new Date(card.expires_at).getTime() <= Date.now() ? 'expired' : 'active';
}

export function giftClaimUrl(code: string): string {
  return `${window.location.origin}/gift/${code}`;
}
