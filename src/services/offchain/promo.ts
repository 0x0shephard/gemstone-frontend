import { invokeEdgeFunction } from './invoke';
import type { GiftCardState } from './gift';

export type PromoState = 'open' | 'sold_out' | 'closed';

export interface PromoSummary {
  code: string;
  title: string;
  message: string | null;
  state: PromoState;
  remaining: number;
  sampleGemId: string | null;
}

/** What a claim returns: the gift-claim result for the token assigned to you. */
export interface PromoClaimResult {
  state: GiftCardState;
  tokenId: string;
  gemId: string | null;
  transactionHash?: string;
  recipientWallet?: string;
}

export interface PromoCampaign {
  id: string;
  code: string;
  title: string;
  message: string | null;
  max_claims: number;
  active: boolean;
  created_at: string;
  pooled: number;
  claimed: number;
  remaining: number;
  state: PromoState;
}

export interface PromoAdminView {
  operatorWallet: string;
  campaigns: PromoCampaign[];
  pool: Array<{ campaign_id: string; token_id: string; gem_id: string | null; added_at: string }>;
  claims: Array<{
    campaign_id: string;
    token_id: string;
    email: string;
    wallet: string;
    created_at: string;
    gift_cards: { status: string; claim_tx_hash: string | null } | null;
  }>;
}

export function inspectPromo(code: string): Promise<PromoSummary> {
  return invokeEdgeFunction<PromoSummary>('v1-promo', { action: 'inspect', code });
}

export function claimPromo(code: string): Promise<PromoClaimResult> {
  return invokeEdgeFunction<PromoClaimResult>('v1-promo', { action: 'claim', code });
}

export function listPromotions(): Promise<PromoAdminView> {
  return invokeEdgeFunction<PromoAdminView>('v1-promo', { action: 'admin_list' });
}

export function createPromotion(input: {
  code: string;
  title: string;
  message?: string;
  maxClaims: number;
}): Promise<{ campaign: { id: string; code: string } }> {
  return invokeEdgeFunction('v1-promo', { action: 'admin_create', ...input });
}

export function updatePromotion(input: {
  campaignId: string;
  active?: boolean;
  maxClaims?: number;
}): Promise<{ ok: true }> {
  return invokeEdgeFunction('v1-promo', { action: 'admin_update', ...input });
}

export function addPromotionTokens(input: {
  campaignId: string;
  tokenIds: string[];
  depositedFrom: string;
}): Promise<{ added: string[]; refused: Array<{ tokenId: string; reason: string }> }> {
  return invokeEdgeFunction('v1-promo', { action: 'admin_add_tokens', ...input });
}

/** The public claim link a QR code points at. */
export function promoClaimUrl(code: string, origin = window.location.origin): string {
  return `${origin}/claim?code=${encodeURIComponent(code)}`;
}
