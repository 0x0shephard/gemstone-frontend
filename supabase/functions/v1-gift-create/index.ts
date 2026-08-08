import { getAddress, isAddress } from 'npm:viem@2';
import { adminClient, audit, requireUser } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { assertOperatorChain, dgeNftAbi, dgeNftAddress, operatorChain } from '../_shared/chain.ts';
import { formatGiftCode, generateGiftCode, hashGiftCode } from '../_shared/gift.ts';

/**
 * Issues a gift card over a token the caller owns.
 *
 * Every precondition is read from the chain rather than taken on trust, because
 * the failure this guards against is not fraud but disappointment: a card
 * printed against a token that has moved, or that was never approved, fails at
 * the one moment nobody can fix it — when the recipient is standing there with
 * the card in their hand.
 *
 * The caller must have granted the operator a per-token approval before calling
 * this. That is the only custody change in the whole flow; the token itself
 * stays in the sender's wallet until someone claims the card.
 */

const MAX_MESSAGE = 500;
const TEMPLATES = new Set(['classic', 'noir', 'celebration']);

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;

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
    /*
     * The email is what makes the card safe to print. A code with no address
     * behind it is a bearer instrument: whoever photographs the card takes the
     * gemstone, including anyone who handles it in the post.
     */
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

    // The wallet is the one the sender proved with SIWE, not one they typed.
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

    const chain = operatorChain();
    await assertOperatorChain(chain);
    const nft = dgeNftAddress();

    const [owner, approved, locked, gemId] = (await Promise.all([
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
      chain.publicClient.readContract({
        address: nft,
        abi: dgeNftAbi,
        functionName: 'tokenGem',
        args: [tokenId],
      }),
    ])) as [string, string, boolean, bigint];

    if (getAddress(owner) !== senderWallet) {
      return json({ error: 'Your verified wallet does not hold this token' }, 403);
    }
    if (locked) {
      return json({ error: 'This token is locked while its redemption is in progress' }, 409);
    }
    if (getAddress(approved) !== getAddress(chain.account.address)) {
      return json({ error: 'Approve Digital Carat for this token before creating the card' }, 409);
    }

    /*
     * The claim window is the stone's reserve escrow term, not a duration this
     * protocol chose. A voucher over a tokenised gemstone cannot outlive the
     * escrow backing the gemstone, so the date is read from the custody record
     * rather than computed — and when it is missing the card is refused, since
     * an invented expiry on a printed voucher is the one thing that cannot be
     * corrected afterwards.
     */
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

    const { data: card, error } = await admin
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
        expires_at: expiresAt.toISOString(),
      })
      .select('id,expires_at')
      .single();

    if (error) {
      // The partial unique index is the only realistic conflict here, and its
      // message is unreadable. Say what the sender has to do about it.
      if (error.code === '23505') {
        return json(
          {
            error: 'This token already has an active gift card. Cancel it before issuing another.',
          },
          409,
        );
      }
      throw error;
    }

    await audit(user.id, 'gift.created', 'gift_card', card.id, {
      tokenId: tokenId.toString(),
      expiresAt: expiresAt.toISOString(),
    });

    /*
     * The only time the code is ever readable. It is stored hashed, so a sender
     * who loses the printed card cannot recover it — they cancel and reissue.
     */
    return json({
      giftId: card.id,
      code,
      displayCode: formatGiftCode(code),
      expiresAt: card.expires_at,
      tokenId: tokenId.toString(),
      gemId: gemId.toString(),
    });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not create the gift card') }, 400);
  }
});
