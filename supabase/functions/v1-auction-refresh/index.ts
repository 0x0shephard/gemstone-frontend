import { adminClient, audit } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  assertOperatorChain,
  gemRegistryAbi,
  operatorChain,
  primarySaleAbi,
  writeAndConfirm,
} from '../_shared/chain.ts';

/**
 * Re-opens the 24-hour auction for stones that drew no bid.
 *
 * A gemstone becomes a token only by being won at auction, so an expired auction
 * with no bidder is a dead end: the stone stays `Listed` with no route forward.
 * This sweep clears the stale auction and opens the next round, up to
 * {@link MAX_ROUNDS}.
 *
 * A scheduled job, not a user endpoint: callers present a secret rather than a
 * Supabase session, exactly as `v1-demand-refresh` does. It is safe to run more
 * often than daily — an auction that has not expired is skipped untouched.
 */

/** 60 × 24h ≈ two months on the block before an operator decides. */
const MAX_ROUNDS = 60;

/** Bounded so one slow run cannot exhaust the function's wall clock. */
const BATCH = 25;

interface Candidate {
  id: string;
  seller_id: string;
  onchain_gem_id: string;
  auction_rounds: number;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('AUCTION_REFRESH_SECRET')?.trim();
  if (!expected) return json({ error: 'Auction refresh is not configured' }, 503);
  if (request.headers.get('x-auction-refresh-secret') !== expected) {
    return json({ error: 'Forbidden' }, 403);
  }

  try {
    const admin = adminClient();
    const chain = operatorChain();
    await assertOperatorChain(chain);

    const { data, error } = await admin
      .from('seller_submissions')
      .select('id,seller_id,onchain_gem_id,auction_rounds')
      .eq('status', 'registered')
      .eq('sale_mode', 'auction')
      .not('onchain_gem_id', 'is', null)
      .is('auction_exhausted_at', null)
      .order('auction_last_opened_at', { ascending: true, nullsFirst: true })
      .limit(BATCH);
    if (error) throw error;

    const now = BigInt(Math.floor(Date.now() / 1_000));
    const reopened: string[] = [];
    const exhausted: string[] = [];
    const skipped: Array<{ gemId: string; reason: string }> = [];

    for (const submission of (data ?? []) as Candidate[]) {
      const gemId = BigInt(submission.onchain_gem_id);
      try {
        const gem = (await chain.publicClient.readContract({
          address: chain.addresses.registry,
          abi: gemRegistryAbi,
          functionName: 'getGem',
          args: [gemId],
        })) as { priceUsd: bigint; tokenId: bigint; status: number };

        // Minted already: the auction did its job and this row is simply stale.
        if (gem.tokenId > 0n || gem.status !== 4) {
          skipped.push({ gemId: String(gemId), reason: 'no longer awaiting a first sale' });
          continue;
        }

        const auction = (await chain.publicClient.readContract({
          address: chain.addresses.primarySale,
          abi: primarySaleAbi,
          functionName: 'auctions',
          args: [gemId],
        })) as readonly [boolean, boolean, bigint, bigint, bigint, string, ...unknown[]];
        const [exists, settled, , endTime, , highestBidder] = auction;

        if (exists && !settled && endTime > now) {
          skipped.push({ gemId: String(gemId), reason: 'auction still running' });
          continue;
        }
        /*
         * Someone won it. Settlement mints to them and is permissionless, so
         * this sweep must not cancel it — `cancelAuction` would revert anyway
         * while the auction is live, but an expired won auction is cancellable
         * and cancelling it would refund a winning bidder and lose the sale.
         */
        if (exists && !settled && highestBidder !== '0x0000000000000000000000000000000000000000') {
          skipped.push({ gemId: String(gemId), reason: 'awaiting settlement for a winning bid' });
          continue;
        }

        if (submission.auction_rounds >= MAX_ROUNDS) {
          await admin
            .from('seller_submissions')
            .update({ auction_exhausted_at: new Date().toISOString() })
            .eq('id', submission.id);
          await audit(
            submission.seller_id,
            'auction.exhausted',
            'seller_submission',
            submission.id,
            {
              gemId: String(gemId),
              rounds: submission.auction_rounds,
            },
          );
          exhausted.push(String(gemId));
          continue;
        }

        // Clear the stale auction, then open the next round at the same floor.
        if (exists && !settled) {
          await writeAndConfirm(chain, {
            address: chain.addresses.primarySale,
            abi: primarySaleAbi,
            functionName: 'cancelAuction',
            args: [gemId],
          });
        }
        const hash = await writeAndConfirm(chain, {
          address: chain.addresses.primarySale,
          abi: primarySaleAbi,
          functionName: 'createDailyAuction',
          args: [gemId, gem.priceUsd],
        });

        await admin
          .from('seller_submissions')
          .update({
            auction_rounds: submission.auction_rounds + 1,
            auction_last_opened_at: new Date().toISOString(),
            auction_tx_hash: hash,
          })
          .eq('id', submission.id);
        await audit(submission.seller_id, 'auction.reopened', 'seller_submission', submission.id, {
          gemId: String(gemId),
          round: submission.auction_rounds + 1,
          transactionHash: hash,
        });
        reopened.push(String(gemId));
      } catch (gemError) {
        // One stone must not abort the sweep; the next run retries it.
        skipped.push({
          gemId: String(gemId),
          reason: safeErrorMessage(gemError, 'Re-auction failed'),
        });
      }
    }

    return json({ examined: data?.length ?? 0, reopened, exhausted, skipped });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Auction refresh failed') }, 500);
  }
});
