import { getAddress, isAddress } from 'npm:viem@2';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { assertOperatorChain, dgeNftAbi, dgeNftAddress, operatorChain } from '../_shared/chain.ts';
import {
  formatGiftCode,
  generateGiftCode,
  hashGiftCode,
  normalizeGiftCode,
} from '../_shared/gift.ts';

/**
 * Prepares and activates an email-bound escrow gift.
 *
 * `prepare` writes the recoverable off-chain record before the sender moves the
 * NFT. The browser then transfers the token to the operator wallet and calls
 * `confirm`; only a chain read proving escrow custody can make the card active.
 * A closed tab can therefore leave a cancellable pending record, never an
 * unexplained operator-held token.
 */

const MAX_MESSAGE = 500;
const TEMPLATES = new Set(['classic', 'noir', 'celebration']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TX_HASH = /^0x[0-9a-f]{64}$/i;

interface GiftRow {
  id: string;
  token_id: string;
  gem_id: string;
  code_hash: string;
  status: string;
  custody_mode: string;
  escrow_wallet: string;
  expires_at: string;
}

const SELECT =
  'id,token_id::text,gem_id::text,code_hash,status,custody_mode,escrow_wallet,expires_at';

function giftResponse(card: GiftRow, code: string, escrowed: boolean) {
  return {
    giftId: card.id,
    code,
    displayCode: formatGiftCode(code),
    expiresAt: card.expires_at,
    tokenId: card.token_id,
    gemId: card.gem_id,
    escrowWallet: getAddress(card.escrow_wallet),
    escrowed,
  };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? 'prepare');
    const chain = operatorChain();
    await assertOperatorChain(chain);
    const nft = dgeNftAddress();
    const escrowWallet = getAddress(chain.account.address);

    if (action === 'confirm') {
      const giftId = String(body.giftId ?? '');
      const code = normalizeGiftCode(body.code);
      if (!UUID.test(giftId) || !code) return json({ error: 'That gift setup is not valid' }, 400);

      const { data } = await admin
        .from('gift_cards')
        .select(SELECT)
        .eq('id', giftId)
        .eq('sender_id', user.id)
        .eq('code_hash', await hashGiftCode(code))
        .maybeSingle();
      const card = data as GiftRow | null;
      if (!card || card.custody_mode !== 'operator_escrow') {
        return json({ error: 'That gift setup is not available' }, 404);
      }
      if (getAddress(card.escrow_wallet) !== escrowWallet) {
        return json({ error: 'The configured gift escrow wallet has changed' }, 409);
      }
      if (card.status === 'active') return json(giftResponse(card, code, true));
      if (card.status !== 'pending_escrow') {
        return json({ error: 'That gift setup is no longer pending' }, 409);
      }
      if (new Date(card.expires_at).getTime() <= Date.now()) {
        return json({ error: 'This gift setup expired before escrow was confirmed' }, 409);
      }

      const tokenId = BigInt(card.token_id);
      const [owner, locked] = (await Promise.all([
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
      ])) as [string, boolean];
      if (locked) return json({ error: 'This token became locked during gift setup' }, 409);
      if (getAddress(owner) !== escrowWallet) {
        return json({ error: 'Transfer the token into Digital Carat escrow first' }, 409);
      }

      const escrowTxHash = String(body.escrowTxHash ?? '');
      const now = new Date().toISOString();
      const { data: activated } = await admin
        .from('gift_cards')
        .update({
          status: 'active',
          escrowed_at: now,
          escrow_tx_hash: TX_HASH.test(escrowTxHash) ? escrowTxHash.toLowerCase() : null,
        })
        .eq('id', card.id)
        .eq('status', 'pending_escrow')
        .select(SELECT)
        .maybeSingle();
      if (!activated) return json({ error: 'That gift setup was already completed' }, 409);

      await audit(user.id, 'gift.escrowed', 'gift_card', card.id, {
        tokenId: card.token_id,
        escrowWallet,
        transactionHash: TX_HASH.test(escrowTxHash) ? escrowTxHash : null,
      });
      return json(giftResponse(activated as GiftRow, code, true));
    }

    if (action !== 'prepare') return json({ error: 'Unknown action' }, 400);

    const tokenIdRaw = String(body.tokenId ?? '').trim();
    if (!/^\d+$/.test(tokenIdRaw) || tokenIdRaw === '0') {
      return json({ error: 'A minted token id is required' }, 400);
    }
    const tokenId = BigInt(tokenIdRaw);
    const recipientEmail = String(body.recipientEmail ?? '')
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(recipientEmail)) {
      return json({ error: 'A valid recipient email address is required' }, 400);
    }
    if (recipientEmail === (user.email ?? '').toLowerCase()) {
      return json({ error: 'That is your own email address' }, 400);
    }
    const recipientName = String(body.recipientName ?? '').trim() || null;
    const message = String(body.message ?? '').trim();
    if (message.length > MAX_MESSAGE) {
      return json({ error: `Message must be ${MAX_MESSAGE} characters or fewer` }, 400);
    }
    const template = String(body.template ?? 'classic');
    if (!TEMPLATES.has(template)) return json({ error: 'Unknown card template' }, 400);

    const { data: walletLink } = await admin
      .from('wallet_links')
      .select('wallet_address')
      .eq('profile_id', user.id)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    if (!walletLink?.wallet_address || !isAddress(walletLink.wallet_address)) {
      return json({ error: 'Verify a wallet with Sign-In with Ethereum first' }, 400);
    }
    const senderWallet = getAddress(walletLink.wallet_address);

    const [owner, locked, gemId] = (await Promise.all([
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
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'tokenGem',
        args: [tokenId],
      }),
    ])) as [string, boolean, bigint];
    if (getAddress(owner) !== senderWallet) {
      return json({ error: 'Your verified wallet does not hold this token' }, 403);
    }
    if (locked) {
      return json({ error: 'This token is locked while its redemption is in progress' }, 409);
    }

    const { data: custody } = await admin
      .from('seller_submissions')
      .select('reserve_escrow_ends_at')
      .eq('onchain_gem_id', gemId.toString())
      .not('reserve_escrow_ends_at', 'is', null)
      .maybeSingle();
    if (!custody?.reserve_escrow_ends_at) {
      return json(
        {
          error:
            'This gemstone has no recorded reserve escrow end date, so a gift card cannot be dated. Ask the custodian to record it.',
        },
        409,
      );
    }
    const expiresAt = new Date(custody.reserve_escrow_ends_at as string);
    if (expiresAt.getTime() <= Date.now()) {
      return json({ error: 'This gemstone’s reserve escrow has already ended' }, 409);
    }

    const code = generateGiftCode();
    const { data: inserted, error } = await admin
      .from('gift_cards')
      .insert({
        sender_id: user.id,
        sender_wallet: senderWallet.toLowerCase(),
        token_id: tokenId.toString(),
        gem_id: gemId.toString(),
        code_hash: await hashGiftCode(code),
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        message: message || null,
        template,
        status: 'pending_escrow',
        custody_mode: 'operator_escrow',
        escrow_wallet: escrowWallet.toLowerCase(),
        expires_at: expiresAt.toISOString(),
      })
      .select(SELECT)
      .single();
    if (error) {
      if (error.code === '23505') {
        return json(
          { error: 'This token already has a pending or active gift. Cancel it first.' },
          409,
        );
      }
      throw error;
    }

    await audit(user.id, 'gift.prepared', 'gift_card', inserted.id, {
      tokenId: tokenId.toString(),
      escrowWallet,
      expiresAt: expiresAt.toISOString(),
    });
    return json(giftResponse(inserted as GiftRow, code, false));
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not prepare the gift') }, 400);
  }
});
