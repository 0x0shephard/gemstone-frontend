import { EdgeFunctionOutcomeUnknownError, invokeEdgeFunction, requireClient } from './invoke';
import type { GiftTemplate } from '@/components/gift/GiftCardArt';
import type { Address, Hash } from 'viem';

export type GiftCardState =
  'pending' | 'active' | 'claiming' | 'claimed' | 'cancelling' | 'cancelled' | 'expired';

export interface GiftCardRow {
  id: string;
  token_id: string;
  gem_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  message: string | null;
  template: GiftTemplate;
  status:
    'pending_escrow' | 'active' | 'claim_pending' | 'claimed' | 'cancel_pending' | 'cancelled';
  custody_mode: 'approval' | 'operator_escrow';
  escrow_wallet: string | null;
  escrowed_at: string | null;
  escrow_tx_hash: string | null;
  claimed_wallet: string | null;
  claimed_at: string | null;
  claim_tx_hash: string | null;
  expires_at: string;
  created_at: string;
}

export interface GiftCardEventRow {
  id: number;
  gift_id: string;
  token_id: string;
  gem_id: string | null;
  event_type:
    'prepared' | 'escrowed' | 'claim_submitted' | 'claimed' | 'cancel_submitted' | 'cancelled';
  occurred_at: string;
  transaction_hash: string | null;
}

/** Whether the sender's printable copy actually left, as the server saw it. */
export type SenderCopyOutcome =
  | { status: 'sent' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export interface CreatedGiftCard {
  giftId: string;
  /** The only time this is ever readable — it is stored hashed. */
  code: string;
  displayCode: string;
  expiresAt: string;
  tokenId: string;
  gemId: string;
  escrowWallet: Address;
  escrowed: boolean;
  /** Present on activation responses only. */
  senderCopy?: SenderCopyOutcome;
  /** Whether the recipient's claim email went out at activation. */
  recipientEmail?: SenderCopyOutcome;
  /** Present on resume responses: where the token is right now. */
  custody?: 'escrow' | 'sender';
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

const GIFT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function freshGiftCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => GIFT_ALPHABET[byte & 31])
    .join('');
}

export interface GiftPreparationKey {
  clientRequestId: string;
  code: string;
}

export function createGiftPreparationKey(): GiftPreparationKey {
  return { clientRequestId: crypto.randomUUID(), code: freshGiftCode() };
}

export async function createGiftCard(
  input: {
    tokenId: bigint;
    recipientEmail: string;
    recipientName?: string;
    message?: string;
    template: GiftTemplate;
  },
  preparation: GiftPreparationKey = createGiftPreparationKey(),
): Promise<CreatedGiftCard> {
  // Both values remain stable across deadline recovery. The server stores only
  // the code hash and returns the same row for this sender/request pair.
  const body = {
    ...input,
    action: 'prepare',
    tokenId: input.tokenId.toString(),
    clientRequestId: preparation.clientRequestId,
    code: preparation.code,
  };
  try {
    return await invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', body);
  } catch (error) {
    if (!(error instanceof EdgeFunctionOutcomeUnknownError)) throw error;
    return invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', body);
  }
}

export async function confirmGiftCardEscrow(
  card: Pick<CreatedGiftCard, 'giftId' | 'code'>,
  escrowTxHash: Hash,
): Promise<CreatedGiftCard> {
  const body = {
    action: 'confirm',
    giftId: card.giftId,
    code: card.code,
    escrowTxHash,
  };
  try {
    return await invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', body);
  } catch (error) {
    if (!(error instanceof EdgeFunctionOutcomeUnknownError)) throw error;
    // Confirm is a pure reconciliation keyed by the existing gift and transfer
    // hash; repeating it cannot submit another chain transaction.
    return invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', body);
  }
}

export function inspectGiftCard(code: string): Promise<GiftCardSummary> {
  return invokeEdgeFunction<GiftCardSummary>('v1-gift-claim', { action: 'inspect', code });
}

export function claimGiftCard(code: string): Promise<GiftCardSummary> {
  return invokeEdgeFunction<GiftCardSummary>('v1-gift-claim', { action: 'claim', code });
}

/**
 * Emails the claim link to the recipient.
 *
 * Takes the code because the server does not have it — only its hash is stored.
 * The sender holds it for as long as the issuing screen is open, which is the
 * whole window in which this can be called.
 */
export function emailGiftCard(code: string): Promise<{ sent: boolean; to: string }> {
  return invokeEdgeFunction('v1-gift-notify', { code });
}

/**
 * Continues a pending card whose code this tab does not hold.
 *
 * The server swaps in a fresh code (a pending card was never claimable, so the
 * lost one was never usable). The same code is re-sent on an unknown outcome,
 * which the server treats as the same request.
 */
export async function resumeGiftCard(giftId: string): Promise<CreatedGiftCard> {
  const body = { action: 'resume', giftId, code: freshGiftCode() };
  try {
    return await invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', body);
  } catch (error) {
    if (!(error instanceof EdgeFunctionOutcomeUnknownError)) throw error;
    return invokeEdgeFunction<CreatedGiftCard>('v1-gift-create', body);
  }
}

/** Re-sends the sender's printable QR copy of an active card. */
export async function resendGiftSenderCopy(
  card: Pick<CreatedGiftCard, 'giftId' | 'code'>,
): Promise<SenderCopyOutcome> {
  const { senderCopy } = await invokeEdgeFunction<{ senderCopy: SenderCopyOutcome }>(
    'v1-gift-create',
    { action: 'sender_copy', giftId: card.giftId, code: card.code },
  );
  return senderCopy;
}

export function cancelGiftCard(giftId: string): Promise<{
  giftId: string;
  status: 'cancel_pending' | 'cancelled';
  tokenId: string;
  returnTxHash: string | null;
}> {
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
      'id,token_id::text,gem_id::text,recipient_email,recipient_name,message,template,status,custody_mode,escrow_wallet,escrowed_at,escrow_tx_hash,claimed_wallet,claimed_at,claim_tx_hash,expires_at,created_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GiftCardRow[];
}

export async function listGiftCardEvents(): Promise<GiftCardEventRow[]> {
  const { data, error } = await requireClient()
    .from('gift_card_events')
    .select('id,gift_id,token_id::text,gem_id::text,event_type,occurred_at,transaction_hash')
    .order('occurred_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GiftCardEventRow[];
}

/**
 * Display state for a stored row.
 *
 * Expiry is a timestamp, never a stored status: no job sets it, because the
 * operator cannot revoke its own per-token approval and so a sweep would have
 * nothing to do. The claim endpoint derives it the same way.
 */
export function giftCardState(card: GiftCardRow): GiftCardState {
  if (card.status === 'pending_escrow') return 'pending';
  if (card.status === 'claim_pending') return 'claiming';
  if (card.status === 'cancel_pending') return 'cancelling';
  if (card.status !== 'active') return card.status;
  return new Date(card.expires_at).getTime() <= Date.now() ? 'expired' : 'active';
}

export function giftClaimUrl(code: string): string {
  return `${window.location.origin}/gift/${code}`;
}
