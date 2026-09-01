import { getAddress, isAddress, zeroAddress } from 'npm:viem@2';
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
 * Inspects and claims an email-bound gift.
 *
 * New cards transfer from the operator escrow wallet. Approval-backed cards
 * issued before the escrow migration keep their original claim path so a live
 * printed card is not invalidated by the upgrade.
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
  custody_mode: string;
  escrow_wallet: string | null;
  expires_at: string;
  created_at: string;
}

const SELECT =
  'id,sender_id,sender_wallet,token_id::text,gem_id::text,recipient_email,recipient_name,message,template,status,custody_mode,escrow_wallet,expires_at,created_at';

async function loadCard(admin: ReturnType<typeof adminClient>, code: string) {
  const { data } = await admin
    .from('gift_cards')
    .select(SELECT)
    .eq('code_hash', await hashGiftCode(code))
    .maybeSingle();
  return (data as GiftRow | null) ?? null;
}

function state(card: GiftRow): 'pending' | 'active' | 'claimed' | 'cancelled' | 'expired' {
  if (card.status === 'pending_escrow') return 'pending';
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
        cardState === 'pending'
          ? 'This gift is still being secured in escrow'
          : cardState === 'claimed'
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

    const chain = operatorChain();
    await assertOperatorChain(chain);
    const operatorWallet = getAddress(chain.account.address);
    const escrowed = card.custody_mode === 'operator_escrow';
    const custodyWallet = escrowed
      ? card.escrow_wallet
        ? getAddress(card.escrow_wallet)
        : zeroAddress
      : senderWallet;
    if (escrowed && custodyWallet !== operatorWallet) {
      return json({ error: 'The gift escrow wallet is not available' }, 409);
    }
    if (recipientWallet === custodyWallet) {
      return json({ error: 'That wallet already holds this token', state: 'active' }, 400);
    }

    const nft = dgeNftAddress();
    const tokenId = BigInt(card.token_id);
    const [owner, locked, approved] = (await Promise.all([
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'ownerOf',
        args: [tokenId],
      }),
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'transferLocked',
        args: [tokenId],
      }),
      escrowed
        ? Promise.resolve(zeroAddress)
        : chain.publicClient.readContract({
            address: nft,
            abi: dgeNftAbi,
            functionName: 'getApproved',
            args: [tokenId],
          }),
    ])) as [string, boolean, string];

    if (getAddress(owner) !== custodyWallet) {
      return json(
        {
          error: escrowed
            ? 'This token is no longer held in gift escrow'
            : 'The sender no longer holds this token, so the card cannot be claimed',
        },
        409,
      );
    }
    if (locked) {
      return json({ error: 'This token is locked while its redemption is in progress' }, 409);
    }
    if (!escrowed && getAddress(approved) !== operatorWallet) {
      return json({ error: 'The sender withdrew permission to transfer this token' }, 409);
    }

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
        args: [custodyWallet, recipientWallet, tokenId],
      });
    } catch (transferError) {
      await admin
        .from('gift_cards')
        .update({ status: 'active', claimed_by: null, claimed_wallet: null, claimed_at: null })
        .eq('id', card.id)
        .eq('status', 'claimed');
      throw transferError;
    }

    await admin.from('gift_cards').update({ claim_tx_hash: hash }).eq('id', card.id);
    await audit(user.id, 'gift.claimed', 'gift_card', card.id, {
      tokenId: card.token_id,
      custodyMode: card.custody_mode,
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
