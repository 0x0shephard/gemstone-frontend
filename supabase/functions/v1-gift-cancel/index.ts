import { getAddress } from 'npm:viem@2';
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

/** Cancel a pending/live gift and return an escrowed NFT to its sender. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GiftRow {
  id: string;
  sender_wallet: string;
  token_id: string;
  status: 'pending_escrow' | 'active';
  custody_mode: 'approval' | 'operator_escrow';
  escrow_wallet: string | null;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const body = (await request.json()) as Record<string, unknown>;
    const giftId = String(body.giftId ?? '');
    if (!UUID.test(giftId)) return json({ error: 'Gift card ID must be a UUID' }, 400);

    const { data } = await admin
      .from('gift_cards')
      .select('id,sender_wallet,token_id::text,status,custody_mode,escrow_wallet')
      .eq('id', giftId)
      .eq('sender_id', user.id)
      .in('status', ['pending_escrow', 'active'])
      .maybeSingle();
    const card = data as GiftRow | null;
    if (!card) {
      return json({ error: 'That gift card is not open, or is not yours to cancel' }, 409);
    }

    let returnTxHash: string | null = null;
    if (card.custody_mode === 'operator_escrow') {
      const chain = operatorChain();
      await assertOperatorChain(chain);
      const operatorWallet = getAddress(chain.account.address);
      const escrowWallet = card.escrow_wallet ? getAddress(card.escrow_wallet) : operatorWallet;
      const senderWallet = getAddress(card.sender_wallet);
      if (escrowWallet !== operatorWallet) {
        return json({ error: 'The gift escrow wallet is not available' }, 409);
      }

      const nft = dgeNftAddress();
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
      const ownerAddress = getAddress(owner);
      if (ownerAddress !== senderWallet && ownerAddress !== escrowWallet) {
        return json({ error: 'This token is no longer held by the sender or gift escrow' }, 409);
      }
      if (locked) return json({ error: 'This token is locked by an active redemption' }, 409);

      // Win the race against a claim before moving the NFT. Restore the open
      // state if the return transaction fails.
      const { data: cancelled } = await admin
        .from('gift_cards')
        .update({ status: 'cancelled' })
        .eq('id', card.id)
        .eq('status', card.status)
        .select('id')
        .maybeSingle();
      if (!cancelled) return json({ error: 'This gift card was already claimed' }, 409);

      if (ownerAddress === escrowWallet) {
        try {
          returnTxHash = await writeAndConfirm(chain, {
            address: nft,
            abi: dgeNftAbi,
            functionName: 'safeTransferFrom',
            args: [escrowWallet, senderWallet, tokenId],
          });
        } catch (returnError) {
          await admin
            .from('gift_cards')
            .update({ status: card.status })
            .eq('id', card.id)
            .eq('status', 'cancelled');
          throw returnError;
        }
      }

      await admin
        .from('gift_cards')
        .update({
          returned_at: new Date().toISOString(),
          return_tx_hash: returnTxHash,
        })
        .eq('id', card.id);
    } else {
      const { data: cancelled } = await admin
        .from('gift_cards')
        .update({ status: 'cancelled' })
        .eq('id', card.id)
        .eq('status', card.status)
        .select('id')
        .maybeSingle();
      if (!cancelled) return json({ error: 'This gift card was already claimed' }, 409);
    }

    await audit(user.id, 'gift.cancelled', 'gift_card', card.id, {
      tokenId: card.token_id,
      custodyMode: card.custody_mode,
      returnTransactionHash: returnTxHash,
    });
    return json({
      giftId: card.id,
      status: 'cancelled',
      tokenId: card.token_id,
      returnTxHash,
    });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not cancel the gift card') }, 400);
  }
});
