import { getAddress, isAddress, parseEventLogs, zeroAddress } from 'npm:viem@2';
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
import { reconcileGiftTransfer } from '../_shared/giftMutation.ts';
import { claimGiftTransferLease, releaseGiftTransferLease } from '../_shared/giftTransferLease.ts';

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
  claimed_by: string | null;
  claimed_wallet: string | null;
  claimed_at: string | null;
  claim_tx_hash: string | null;
  return_tx_hash: string | null;
  operation_nonce: number | string | null;
  operation_started_at: string | null;
  expires_at: string;
  created_at: string;
}

const SELECT =
  'id,sender_id,sender_wallet,token_id::text,gem_id::text,recipient_email,recipient_name,message,template,status,custody_mode,escrow_wallet,claimed_by,claimed_wallet,claimed_at,claim_tx_hash,return_tx_hash,operation_nonce,operation_started_at,expires_at,created_at';

async function loadCard(admin: ReturnType<typeof adminClient>, code: string) {
  const { data } = await admin
    .from('gift_cards')
    .select(SELECT)
    .eq('code_hash', await hashGiftCode(code))
    .maybeSingle();
  return (data as GiftRow | null) ?? null;
}

function state(
  card: GiftRow,
): 'pending' | 'active' | 'claiming' | 'claimed' | 'cancelling' | 'cancelled' | 'expired' {
  if (card.status === 'pending_escrow') return 'pending';
  if (card.status === 'claim_pending') return 'claiming';
  if (card.status === 'cancel_pending') return 'cancelling';
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
      transactionHash: card.claim_tx_hash ?? card.return_tx_hash ?? undefined,
    };

    if (body.action === 'inspect') return json(summary);
    if (body.action !== 'claim') return json({ error: 'Unknown action' }, 400);

    if (cardState !== 'active' && cardState !== 'claiming') {
      const reason =
        cardState === 'pending'
          ? 'This gift is still being secured in escrow'
          : cardState === 'claimed'
            ? 'This gift card has already been claimed'
            : cardState === 'cancelled'
              ? 'The sender cancelled this gift card'
              : cardState === 'cancelling'
                ? 'This gift is being returned to its sender'
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

    async function submitClaimTransfer(initialAttempt: boolean, nonce?: number): Promise<Response> {
      let submissionAttempted = false;
      let submittedHash: string | null = null;
      let retainLease = false;
      const leaseHolder = crypto.randomUUID();
      let leaseClaimed = false;
      try {
        leaseClaimed = await claimGiftTransferLease(admin, leaseHolder);
      } catch (leaseError) {
        if (!initialAttempt) {
          return json({ ...summary, state: 'claiming', recipientWallet }, 202);
        }
        await admin
          .from('gift_cards')
          .update({
            status: 'active',
            claimed_by: null,
            claimed_wallet: null,
            operation_started_at: null,
            operation_nonce: null,
          })
          .eq('id', card.id)
          .eq('status', 'claim_pending');
        throw leaseError;
      }
      if (!leaseClaimed) {
        if (!initialAttempt) {
          return json({ ...summary, state: 'claiming', recipientWallet }, 202);
        }
        await admin
          .from('gift_cards')
          .update({
            status: 'active',
            claimed_by: null,
            claimed_wallet: null,
            operation_started_at: null,
            operation_nonce: null,
          })
          .eq('id', card.id)
          .eq('status', 'claim_pending');
        return json({ error: 'Gift transfers are busy. Try the claim again shortly.' }, 409);
      }
      try {
        submittedHash = await writeAndConfirm(
          chain,
          {
            address: nft,
            abi: dgeNftAbi,
            functionName: 'safeTransferFrom',
            args: [custodyWallet, recipientWallet, tokenId],
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
                .eq('status', 'claim_pending')
                .select('id')
                .maybeSingle();
              if (error) throw error;
              if (!lockedIntent) throw new Error('The gift claim is no longer pending');
              submissionAttempted = true;
            },
            onSubmitted: async (hash) => {
              submittedHash = hash;
              const { error } = await admin
                .from('gift_cards')
                .update({ claim_tx_hash: hash })
                .eq('id', card.id)
                .eq('status', 'claim_pending');
              if (error) throw error;
            },
          },
        );
      } catch (transferError) {
        if (submissionAttempted) {
          // The RPC may have accepted the signed transaction before losing its
          // response. Keep both the per-gift pending row and the shared lease;
          // another gift must not observe a stale pending nonce and replace it.
          retainLease = true;
          return json(
            {
              ...summary,
              state: 'claiming',
              transactionHash: submittedHash ?? undefined,
              recipientWallet,
            },
            202,
          );
        }
        if (!initialAttempt) {
          return json({ ...summary, state: 'claiming', recipientWallet }, 202);
        }
        await admin
          .from('gift_cards')
          .update({
            status: 'active',
            claimed_by: null,
            claimed_wallet: null,
            operation_started_at: null,
            operation_nonce: null,
          })
          .eq('id', card.id)
          .eq('status', 'claim_pending');
        throw transferError;
      } finally {
        if (!retainLease) await releaseGiftTransferLease(admin, leaseHolder);
      }

      const claimedAt = new Date().toISOString();
      await admin
        .from('gift_cards')
        .update({
          status: 'claimed',
          claimed_at: claimedAt,
          operation_started_at: null,
          operation_nonce: null,
        })
        .eq('id', card.id)
        .eq('status', 'claim_pending');
      await audit(user.id, 'gift.claimed', 'gift_card', card.id, {
        tokenId: card.token_id,
        custodyMode: card.custody_mode,
        transactionHash: submittedHash,
      });
      return json({
        ...summary,
        state: 'claimed',
        transactionHash: submittedHash,
        recipientWallet,
      });
    }

    // A prior call may have timed out after broadcasting. Reconcile that exact
    // operation before any path is allowed to submit another transfer.
    if (card.status === 'claim_pending') {
      const receipt = card.claim_tx_hash
        ? await chain.publicClient
            .getTransactionReceipt({ hash: card.claim_tx_hash as `0x${string}` })
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
            getAddress(event.args.from) === custodyWallet &&
            getAddress(event.args.to) === recipientWallet,
        );
      const operationNonce = card.operation_nonce === null ? null : Number(card.operation_nonce);
      const [senderPendingNonce, senderLatestNonce] =
        !card.claim_tx_hash && operationNonce !== null
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
        currentOwner: owner,
        destinationOwner: recipientWallet,
        transactionHash: card.claim_tx_hash,
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
        const claimedAt = card.claimed_at ?? new Date().toISOString();
        await admin
          .from('gift_cards')
          .update({
            status: 'claimed',
            claimed_at: claimedAt,
            operation_started_at: null,
            operation_nonce: null,
          })
          .eq('id', card.id)
          .eq('status', 'claim_pending');
        await audit(user.id, 'gift.claimed', 'gift_card', card.id, {
          tokenId: card.token_id,
          custodyMode: card.custody_mode,
          transactionHash: card.claim_tx_hash,
          reconciled: true,
        });
        return json({
          ...summary,
          state: 'claimed',
          transactionHash: card.claim_tx_hash ?? undefined,
          recipientWallet,
        });
      }
      if (reconciliation === 'failed') {
        await admin
          .from('gift_cards')
          .update({
            status: 'active',
            claimed_by: null,
            claimed_wallet: null,
            claimed_at: null,
            claim_tx_hash: null,
            operation_started_at: null,
            operation_nonce: null,
          })
          .eq('id', card.id)
          .eq('status', 'claim_pending');
        return json({ error: 'The claim transaction reverted. It is safe to try again.' }, 409);
      }
      if (
        (reconciliation === 'retry_same_nonce' || reconciliation === 'retry_fresh_nonce') &&
        operationNonce !== null
      ) {
        if (getAddress(owner) !== custodyWallet || locked) {
          return json({ ...summary, state: 'claiming', recipientWallet }, 202);
        }
        if (!escrowed && getAddress(approved) !== operatorWallet) {
          return json({ ...summary, state: 'claiming', recipientWallet }, 202);
        }
        const retryStartedAt = new Date().toISOString();
        let retryLease = admin
          .from('gift_cards')
          .update({ operation_started_at: retryStartedAt })
          .eq('id', card.id)
          .eq('status', 'claim_pending');
        retryLease = card.operation_started_at
          ? retryLease.eq('operation_started_at', card.operation_started_at)
          : retryLease.is('operation_started_at', null);
        const { data: leased } = await retryLease.select('id').maybeSingle();
        if (!leased) return json({ ...summary, state: 'claiming', recipientWallet }, 202);
        return submitClaimTransfer(
          false,
          reconciliation === 'retry_same_nonce' ? operationNonce : undefined,
        );
      }
      return json(
        {
          ...summary,
          state: 'claiming',
          transactionHash: card.claim_tx_hash ?? undefined,
          recipientWallet,
        },
        202,
      );
    }

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

    const operationStartedAt = new Date().toISOString();
    const { data: taken } = await admin
      .from('gift_cards')
      .update({
        status: 'claim_pending',
        claimed_by: user.id,
        claimed_wallet: recipientWallet.toLowerCase(),
        operation_started_at: operationStartedAt,
      })
      .eq('id', card.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (!taken) {
      return json({ error: 'This gift claim is already being processed', state: 'claiming' }, 409);
    }

    return submitClaimTransfer(true);
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Could not claim the gift card') }, 400);
  }
});
