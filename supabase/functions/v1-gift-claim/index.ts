import { getAddress, isAddress } from 'npm:viem@2';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  assertOperatorChain,
  dgeNftAbi,
  dgeNftAddress,
  operatorChain,
  writeAndConfirm,
} from '../_shared/chain.ts';
import { hashGiftCode, maskEmail, normalizeGiftCode } from '../_shared/gift.ts';

/**
 * Reads and redeems a gift card.
 *
 * `inspect` runs before anyone has signed in — the claim page has to show what
 * the card is for before it can reasonably ask for an email address — so it
 * returns only what is already printed on the card the caller is holding.
 *
 * `claim` is the transfer. It moves the token with the single-token approval
 * the sender granted at issue time, from the sender straight to the recipient's
 * own verified wallet. Nothing was ever escrowed, so there is no intermediate
 * custody to unwind if this never happens.
 */

interface GiftRow {
  id: string;
  sender_id: string;
  sender_wallet: string;
  token_id: string;
  gem_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  message: string | null;
  template: string;
  status: string;
  expires_at: string;
  created_at: string;
}

const SELECT =
  'id,sender_id,sender_wallet,token_id::text,gem_id::text,recipient_email,recipient_name,message,template,status,expires_at,created_at';

async function loadCard(admin: ReturnType<typeof adminClient>, code: string) {
  const { data } = await admin
    .from('gift_cards')
    .select(SELECT)
    .eq('code_hash', await hashGiftCode(code))
    .maybeSingle();
  return (data as GiftRow | null) ?? null;
}

/**
 * Expiry is derived, never trusted from the stored status. No sweep sets it —
 * there is nothing for a sweep to do, since the operator cannot revoke its own
 * per-token approval — so the timestamp is the only authority.
 */
function state(card: GiftRow): 'active' | 'claimed' | 'cancelled' | 'expired' {
  if (card.status !== 'active') return card.status as 'claimed' | 'cancelled';
  return new Date(card.expires_at).getTime() <= Date.now() ? 'expired' : 'active';
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;
    const code = normalizeGiftCode(body.code);
    // Same answer for a malformed code and an unknown one, so this cannot be
    // used to distinguish "not a code" from "not your code".
    if (!code) return json({ error: 'That gift code is not valid' }, 404);

    const card = await loadCard(admin, code);
    if (!card) return json({ error: 'That gift code is not valid' }, 404);
    const cardState = state(card);

    const { data: senderProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', card.sender_id)
      .maybeSingle();

    const summary = {
      state: cardState,
      tokenId: card.token_id,
      gemId: card.gem_id,
      senderName: (senderProfile?.full_name as string | null) ?? 'A Digital Carat collector',
      recipientName: card.recipient_name,
      recipientEmailMasked: maskEmail(card.recipient_email),
      message: card.message,
      template: card.template,
      expiresAt: card.expires_at,
      createdAt: card.created_at,
    };

    if (body.action === 'inspect') return json(summary);
    if (body.action !== 'claim') return json({ error: 'Unknown action' }, 400);

    if (cardState !== 'active') {
      const reason =
        cardState === 'claimed'
          ? 'This gift card has already been claimed'
          : cardState === 'cancelled'
            ? 'The sender cancelled this gift card'
            : 'This gift card has expired';
      return json({ error: reason, state: cardState }, 409);
    }

    const user = await requireUser(request);
    if ((user.email ?? '').toLowerCase() !== card.recipient_email.toLowerCase()) {
      return json(
        { error: 'This card was issued to a different email address', state: 'active' },
        403,
      );
    }

    const { data: walletLink } = await admin
      .from('wallet_links')
      .select('wallet_address')
      .eq('profile_id', user.id)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (!walletLink?.wallet_address || !isAddress(walletLink.wallet_address)) {
      return json(
        { error: 'Connect and verify a wallet to receive the token', state: 'active' },
        400,
      );
    }
    const recipientWallet = getAddress(walletLink.wallet_address);
    const senderWallet = getAddress(card.sender_wallet);
    if (recipientWallet === senderWallet) {
      return json({ error: 'That wallet already holds this token', state: 'active' }, 400);
    }

    const chain = operatorChain();
    await assertOperatorChain(chain);
    const nft = dgeNftAddress();
    const tokenId = BigInt(card.token_id);

    /*
     * Re-read rather than relying on what was true at issue time. Nothing stops
     * the sender selling, swapping or redeeming the token in the meantime, and
     * all three quietly void the card: a transfer clears the approval, and a
     * redemption locks the token outright.
     */
    const [owner, approved, locked] = (await Promise.all([
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }),
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'getApproved',
        args: [tokenId],
      }),
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'transferLocked',
        args: [tokenId],
      }),
    ])) as [string, string, boolean];

    if (getAddress(owner) !== senderWallet) {
      return json(
        { error: 'The sender no longer holds this token, so the card cannot be claimed' },
        409,
      );
    }
    if (locked) {
      return json({ error: 'This token is locked while its redemption is in progress' }, 409);
    }
    if (getAddress(approved) !== getAddress(chain.account.address)) {
      return json({ error: 'The sender withdrew permission to transfer this token' }, 409);
    }

    /*
     * Take the card before touching the chain, conditionally on it still being
     * active. Two recipients racing the same code — a forwarded email, a
     * refreshed tab — would otherwise both reach `safeTransferFrom`, and the
     * loser's revert is far harder to explain than a second click that says the
     * card is already claimed. Reverted below if the transfer fails.
     */
    const claimedAt = new Date().toISOString();
    const { data: taken } = await admin
      .from('gift_cards')
      .update({
        status: 'claimed',
        claimed_by: user.id,
        claimed_wallet: recipientWallet.toLowerCase(),
        claimed_at: claimedAt,
      })
      .eq('id', card.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (!taken) {
      return json({ error: 'This gift card has already been claimed', state: 'claimed' }, 409);
    }

    let hash: string;
    try {
      hash = await writeAndConfirm(chain, {
        address: nft,
        abi: dgeNftAbi,
        functionName: 'safeTransferFrom',
        args: [senderWallet, recipientWallet, tokenId],
      });
    } catch (transferError) {
      await admin
        .from('gift_cards')
        .update({ status: 'active', claimed_by: null, claimed_wallet: null, claimed_at: null })
        .eq('id', card.id);
      throw transferError;
    }

    await admin.from('gift_cards').update({ claim_tx_hash: hash }).eq('id', card.id);
    await audit(user.id, 'gift.claimed', 'gift_card', card.id, {
      tokenId: card.token_id,
      transactionHash: hash,
    });

    return json({
      ...summary,
      state: 'claimed',
      transactionHash: hash,
      recipientWallet,
    });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not claim the gift card') }, 400);
  }
});
