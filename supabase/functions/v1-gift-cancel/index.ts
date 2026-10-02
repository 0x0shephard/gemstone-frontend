import { getAddress, parseEventLogs } from 'npm:viem@2';
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
import { reconcileGiftTransfer } from '../_shared/giftMutation.ts';
import { claimGiftTransferLease, releaseGiftTransferLease } from '../_shared/giftTransferLease.ts';
import { requireProtocolDeployment } from '../_shared/deployment.ts';

/** Cancel a pending/live gift and return an escrowed NFT to its sender. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GiftRow {
  id: string;
  sender_wallet: string;
  token_id: string;
  status: 'pending_escrow' | 'active' | 'cancel_pending';
  custody_mode: 'approval' | 'operator_escrow';
  escrow_wallet: string | null;
  return_tx_hash: string | null;
  cancel_from_status: 'pending_escrow' | 'active' | null;
  operation_nonce: number | string | null;
  operation_started_at: string | null;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await requireUser(request);
    const admin = adminClient();
    const deployment = await requireProtocolDeployment(admin, request);
    const body = (await request.json()) as Record<string, unknown>;
    const giftId = String(body.giftId ?? '');
    if (!UUID.test(giftId)) return json({ error: 'Gift card ID must be a UUID' }, 400);

    const { data } = await admin
      .from('gift_cards')
      .select(
        'id,sender_wallet,token_id::text,status,custody_mode,escrow_wallet,return_tx_hash,cancel_from_status,operation_nonce,operation_started_at',
      )
      .eq('id', giftId)
      .eq('deployment_id', deployment.id)
      .eq('sender_id', user.id)
      .in('status', ['pending_escrow', 'active', 'cancel_pending'])
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

      async function submitReturn(initialAttempt: boolean, nonce?: number): Promise<Response> {
        let submissionAttempted = false;
        let submittedHash: string | null = null;
        let retainLease = false;
        const leaseHolder = crypto.randomUUID();
        let leaseClaimed = false;
        try {
          leaseClaimed = await claimGiftTransferLease(admin, leaseHolder);
        } catch (leaseError) {
          if (!initialAttempt) {
            return json(
              {
                giftId: card.id,
                status: 'cancel_pending',
                tokenId: card.token_id,
                returnTxHash: null,
              },
              202,
            );
          }
          await admin
            .from('gift_cards')
            .update({
              status: card.status,
              operation_started_at: null,
              operation_nonce: null,
              cancel_from_status: null,
            })
            .eq('id', card.id)
            .eq('deployment_id', deployment.id)
            .eq('status', 'cancel_pending');
          throw leaseError;
        }
        if (!leaseClaimed) {
          if (!initialAttempt) {
            return json(
              {
                giftId: card.id,
                status: 'cancel_pending',
                tokenId: card.token_id,
                returnTxHash: null,
              },
              202,
            );
          }
          await admin
            .from('gift_cards')
            .update({
              status: card.status,
              operation_started_at: null,
              operation_nonce: null,
              cancel_from_status: null,
            })
            .eq('id', card.id)
            .eq('deployment_id', deployment.id)
            .eq('status', 'cancel_pending');
          return json({ error: 'Gift transfers are busy. Try cancellation again shortly.' }, 409);
        }
        try {
          returnTxHash = await writeAndConfirm(
            chain,
            {
              address: nft,
              abi: dgeNftAbi,
              functionName: 'safeTransferFrom',
              args: [escrowWallet, senderWallet, tokenId],
            },
            {
              nonce,
              onSubmitting: async (resolvedNonce) => {
                const { data: lockedIntent, error } = await admin
                  .from('gift_cards')
                  .update({
                    operation_nonce: resolvedNonce,
                    operation_started_at: new Date().toISOString(),
                  })
                  .eq('id', card.id)
                  .eq('deployment_id', deployment.id)
                  .eq('status', 'cancel_pending')
                  .select('id')
                  .maybeSingle();
                if (error) throw error;
                if (!lockedIntent) throw new Error('The gift return is no longer pending');
                submissionAttempted = true;
              },
              onSubmitted: async (hash) => {
                submittedHash = hash;
                const { error } = await admin
                  .from('gift_cards')
                  .update({ return_tx_hash: hash })
                  .eq('id', card.id)
                  .eq('deployment_id', deployment.id)
                  .eq('status', 'cancel_pending');
                if (error) throw error;
              },
            },
          );
        } catch (returnError) {
          if (submissionAttempted) {
            retainLease = true;
            return json(
              {
                giftId: card.id,
                status: 'cancel_pending',
                tokenId: card.token_id,
                returnTxHash: submittedHash,
              },
              202,
            );
          }
          if (!initialAttempt) {
            return json(
              {
                giftId: card.id,
                status: 'cancel_pending',
                tokenId: card.token_id,
                returnTxHash: null,
              },
              202,
            );
          }
          await admin
            .from('gift_cards')
            .update({
              status: card.status,
              operation_started_at: null,
              operation_nonce: null,
              cancel_from_status: null,
            })
            .eq('id', card.id)
            .eq('deployment_id', deployment.id)
            .eq('status', 'cancel_pending');
          throw returnError;
        } finally {
          if (!retainLease) await releaseGiftTransferLease(admin, leaseHolder);
        }

        await admin
          .from('gift_cards')
          .update({
            returned_at: new Date().toISOString(),
            return_tx_hash: returnTxHash,
            status: 'cancelled',
            operation_started_at: null,
            operation_nonce: null,
            cancel_from_status: null,
          })
          .eq('id', card.id)
          .eq('deployment_id', deployment.id)
          .eq('status', 'cancel_pending');
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
      }

      if (card.status === 'cancel_pending') {
        const receipt = card.return_tx_hash
          ? await chain.publicClient
              .getTransactionReceipt({ hash: card.return_tx_hash as `0x${string}` })
              .catch(() => null)
          : null;
        const receiptMatchesTransfer =
          receipt?.status === 'success' &&
          parseEventLogs({
            abi: dgeNftAbi,
            logs: receipt.logs,
            eventName: 'Transfer',
            strict: false,
          }).some(
            (event) =>
              event.address.toLowerCase() === nft.toLowerCase() &&
              event.args.tokenId === tokenId &&
              getAddress(event.args.from) === escrowWallet &&
              getAddress(event.args.to) === senderWallet,
          );
        const operationNonce = card.operation_nonce === null ? null : Number(card.operation_nonce);
        const [senderPendingNonce, senderLatestNonce] =
          !card.return_tx_hash && operationNonce !== null
            ? await Promise.all([
                chain.publicClient.getTransactionCount({
                  address: chain.account.address,
                  blockTag: 'pending',
                }),
                chain.publicClient.getTransactionCount({
                  address: chain.account.address,
                  blockTag: 'latest',
                }),
              ])
            : [null, null];
        const reconciliation = reconcileGiftTransfer({
          currentOwner: ownerAddress,
          destinationOwner: senderWallet,
          transactionHash: card.return_tx_hash,
          receiptStatus: receipt?.status ?? null,
          receiptMatchesTransfer,
          operationNonce,
          senderPendingNonce,
          senderLatestNonce,
          operationAgeMs: card.operation_started_at
            ? Date.now() - new Date(card.operation_started_at).getTime()
            : 0,
        });
        if (reconciliation === 'complete') {
          const returnedAt = new Date().toISOString();
          await admin
            .from('gift_cards')
            .update({
              status: 'cancelled',
              returned_at: returnedAt,
              operation_started_at: null,
              operation_nonce: null,
              cancel_from_status: null,
            })
            .eq('id', card.id)
            .eq('deployment_id', deployment.id)
            .eq('status', 'cancel_pending');
          await audit(user.id, 'gift.cancelled', 'gift_card', card.id, {
            tokenId: card.token_id,
            custodyMode: card.custody_mode,
            returnTransactionHash: card.return_tx_hash,
            reconciled: true,
          });
          return json({
            giftId: card.id,
            status: 'cancelled',
            tokenId: card.token_id,
            returnTxHash: card.return_tx_hash,
          });
        }
        if (reconciliation === 'failed') {
          await admin
            .from('gift_cards')
            .update({
              status: card.cancel_from_status ?? 'active',
              return_tx_hash: null,
              operation_started_at: null,
              operation_nonce: null,
              cancel_from_status: null,
            })
            .eq('id', card.id)
            .eq('deployment_id', deployment.id)
            .eq('status', 'cancel_pending');
          return json({ error: 'The return transaction reverted. It is safe to try again.' }, 409);
        }
        if (
          (reconciliation === 'retry_same_nonce' || reconciliation === 'retry_fresh_nonce') &&
          operationNonce !== null
        ) {
          if (ownerAddress !== escrowWallet || locked) {
            return json(
              {
                giftId: card.id,
                status: 'cancel_pending',
                tokenId: card.token_id,
                returnTxHash: null,
              },
              202,
            );
          }
          const retryStartedAt = new Date().toISOString();
          let retryLease = admin
            .from('gift_cards')
            .update({ operation_started_at: retryStartedAt })
            .eq('id', card.id)
            .eq('deployment_id', deployment.id)
            .eq('status', 'cancel_pending');
          retryLease = card.operation_started_at
            ? retryLease.eq('operation_started_at', card.operation_started_at)
            : retryLease.is('operation_started_at', null);
          const { data: leased } = await retryLease.select('id').maybeSingle();
          if (!leased) {
            return json(
              {
                giftId: card.id,
                status: 'cancel_pending',
                tokenId: card.token_id,
                returnTxHash: null,
              },
              202,
            );
          }
          return submitReturn(
            false,
            reconciliation === 'retry_same_nonce' ? operationNonce : undefined,
          );
        }
        return json(
          {
            giftId: card.id,
            status: 'cancel_pending',
            tokenId: card.token_id,
            returnTxHash: card.return_tx_hash,
          },
          202,
        );
      }
      if (
        card.status === 'active' &&
        ownerAddress !== senderWallet &&
        ownerAddress !== escrowWallet
      ) {
        return json({ error: 'This token is no longer held by the sender or gift escrow' }, 409);
      }
      /*
       * A pending row is only a preparation record. If the wallet never moved
       * the token (or subsequently listed/redeemed it), cancellation must still
       * retire that stale setup. Blocking on its current owner/lock is what left
       * "Waiting for escrow" rows permanently stuck in the portfolio.
       *
       * A token actually held by gift escrow is different: returning it is an
       * on-chain transfer, so an active lock must still stop us.
       */
      if (locked && ownerAddress === escrowWallet) {
        return json({ error: 'This token is locked by an active redemption' }, 409);
      }

      // Win the race against a claim before moving the NFT. Restore the open
      // state if the return transaction fails.
      const { data: cancelled } = await admin
        .from('gift_cards')
        .update({
          status: ownerAddress === escrowWallet ? 'cancel_pending' : 'cancelled',
          cancel_from_status: ownerAddress === escrowWallet ? card.status : null,
          operation_started_at: ownerAddress === escrowWallet ? new Date().toISOString() : null,
          returned_at: ownerAddress === escrowWallet ? null : new Date().toISOString(),
        })
        .eq('id', card.id)
        .eq('deployment_id', deployment.id)
        .eq('status', card.status)
        .select('id')
        .maybeSingle();
      if (!cancelled) return json({ error: 'This gift card was already claimed' }, 409);

      if (ownerAddress === escrowWallet) {
        return submitReturn(true);
      }

      await admin
        .from('gift_cards')
        .update({
          returned_at: new Date().toISOString(),
          return_tx_hash: returnTxHash,
          status: 'cancelled',
          operation_started_at: null,
          operation_nonce: null,
          cancel_from_status: null,
        })
        .eq('id', card.id)
        .eq('deployment_id', deployment.id);
    } else {
      const { data: cancelled } = await admin
        .from('gift_cards')
        .update({ status: 'cancelled' })
        .eq('id', card.id)
        .eq('deployment_id', deployment.id)
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
