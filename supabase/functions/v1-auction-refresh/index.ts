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
 * Candidates come from the **chain**, not from `seller_submissions`. A
 * database-driven sweep can only see gems that arrived through the seller flow,
 * and gem 4 — registered by a seeding script with no submission row — sat with
 * an auction twelve days expired while the sweep reported success. Enumerating
 * the registry means every gem it knows about is covered, however it got there.
 *
 * A scheduled job, not a user endpoint: callers present a secret rather than a
 * Supabase session, exactly as `v1-demand-refresh` does, and `config.toml`
 * exempts it from JWT verification so a scheduler can actually reach it. Safe to
 * run more often than daily — an auction that has not expired is left untouched.
 */

/** 60 × 24h ≈ two months on the block before an operator decides. */
const MAX_ROUNDS = 60;

/** Registry ids are sequential from 1; `getGem` reverts past the last one. */
const PROBE_WINDOW = 25;
const PROBE_LIMIT = 5_000;

/** Bounded so one slow run cannot exhaust the function's wall clock. */
const MAX_REOPENS_PER_RUN = 10;

const ZERO = '0x0000000000000000000000000000000000000000';
const STATUS_LISTED = 4;
const SALE_MODE_AUCTION = 2;

type Chain = ReturnType<typeof operatorChain>;

/**
 * Every gem id the registry holds.
 *
 * `GemRegistry` exposes no enumeration and keeps `_nextGemId` private, but ids
 * run from 1 and gems are never removed, so the set can be probed until
 * `getGem` reverts.
 */
async function discoverGemIds(chain: Chain): Promise<bigint[]> {
  const ids: bigint[] = [];
  for (let start = 1; start <= PROBE_LIMIT; start += PROBE_WINDOW) {
    const window = Array.from({ length: PROBE_WINDOW }, (_, index) => BigInt(start + index));
    const results = await chain.publicClient.multicall({
      contracts: window.map((gemId) => ({
        address: chain.addresses.registry,
        abi: gemRegistryAbi,
        functionName: 'getGem',
        args: [gemId],
      })),
      allowFailure: true,
    });
    const firstFailure = results.findIndex((result) => result.status !== 'success');
    ids.push(...window.slice(0, firstFailure === -1 ? results.length : firstFailure));
    if (firstFailure !== -1) break;
  }
  return ids;
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

    const gemIds = await discoverGemIds(chain);
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const reopened: string[] = [];
    const exhausted: string[] = [];
    const skipped: Array<{ gemId: string; reason: string }> = [];
    let examined = 0;

    for (const gemId of gemIds) {
      if (reopened.length >= MAX_REOPENS_PER_RUN) {
        skipped.push({ gemId: String(gemId), reason: 'deferred to the next run' });
        continue;
      }
      try {
        const gem = (await chain.publicClient.readContract({
          address: chain.addresses.registry,
          abi: gemRegistryAbi,
          functionName: 'getGem',
          args: [gemId],
        })) as { priceUsd: bigint; tokenId: bigint; status: number };

        // Awaiting a first sale means listed and not yet minted. Everything else
        // is simply not this job's business, and stays silent rather than noisy.
        if (Number(gem.status) !== STATUS_LISTED || gem.tokenId > 0n) continue;

        const saleMode = (await chain.publicClient.readContract({
          address: chain.addresses.registry,
          abi: gemRegistryAbi,
          functionName: 'primarySaleMode',
          args: [gemId],
        })) as number;
        // A legacy buy-now gem cannot be auctioned: `listGem` only accepts a gem
        // at `Verified`, so its mode can never be changed. Leave it be.
        if (Number(saleMode) !== SALE_MODE_AUCTION) continue;

        examined += 1;

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
         * Someone won it. Settlement mints to them and is permissionless, so the
         * sweep must not cancel: an expired won auction *is* cancellable, and
         * cancelling would refund the winner and lose the sale.
         */
        if (exists && !settled && highestBidder !== ZERO) {
          skipped.push({ gemId: String(gemId), reason: 'awaiting settlement for a winning bid' });
          continue;
        }

        const { data: cycle } = await admin
          .from('auction_cycles')
          .select('rounds,exhausted_at')
          .eq('gem_id', String(gemId))
          .maybeSingle();
        // A gem with no row has never been counted — a seeded stone, or one from
        // before this table existed. Treat it as round zero rather than skipping.
        if (cycle?.exhausted_at) {
          skipped.push({ gemId: String(gemId), reason: 'round ceiling reached' });
          continue;
        }
        const rounds = cycle?.rounds ?? 0;

        if (rounds >= MAX_ROUNDS) {
          await admin
            .from('auction_cycles')
            .upsert(
              { gem_id: String(gemId), rounds, exhausted_at: new Date().toISOString() },
              { onConflict: 'gem_id' },
            );
          await audit(null, 'auction.exhausted', 'gem', String(gemId), { rounds });
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

        await admin.from('auction_cycles').upsert(
          {
            gem_id: String(gemId),
            rounds: rounds + 1,
            last_opened_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'gem_id' },
        );
        await audit(null, 'auction.reopened', 'gem', String(gemId), {
          round: rounds + 1,
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

    return json({ registryGems: gemIds.length, examined, reopened, exhausted, skipped });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Auction refresh failed') }, 500);
  }
});
