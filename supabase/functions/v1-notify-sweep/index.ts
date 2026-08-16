import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { formatUnits, parseEventLogs, type Address, type Log } from 'npm:viem@2';
import { adminClient } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import {
  dgeNftAbi,
  dgeNftAddress,
  gemRegistryAbi,
  marketplaceAbi,
  marketplaceAddress,
  operatorChain,
  primarySaleAbi,
  redemptionManagerAbi,
  redemptionManagerAddress,
  swapEscrowAbi,
  swapEscrowAddress,
  type OperatorChain,
} from '../_shared/chain.ts';
import { scanLogs } from '../_shared/logScan.ts';
import { notifyWallet } from '../_shared/notify.ts';
import { TIMED_OUT, phaseLog, withDeadline, type PhaseLog } from '../_shared/deadline.ts';

/**
 * Tells people about protocol state that is waiting on them.
 *
 * The protocol could not previously tell anyone anything. An offer on a token
 * expires in 24 hours and the owner learned of it only by opening the right tab;
 * a swap holds the proposer's NFT in escrow until *they* cancel it, with nothing
 * anywhere saying so. Both of those strand real assets, quietly, on a clock.
 *
 * Two passes, because the two failure modes are different shapes:
 *
 *   The event pass reads what happened — an offer arrived, a swap was accepted,
 *   an auction settled — and tells the affected party.
 *
 *   The deadline pass reads what is *about to stop being possible*. A log scan
 *   cannot find this: the event that matters is the absence of one. Positions
 *   are recorded with their expiry as they open, so this is a dated query.
 *
 * A schedule, not a user endpoint: callers present a shared secret rather than a
 * Supabase session, exactly as the other sweeps do, and `config.toml` exempts it
 * from JWT verification so a scheduler can reach it at all.
 */

/**
 * How far back to look on a first run — roughly a week.
 *
 * Far enough to cover any position that could still be open. Scanning from the
 * deployment block would work too, but it would mail everyone about every offer
 * the protocol has ever seen, most of them long dead, and a notification system
 * whose first act is a flood of stale mail teaches people to ignore it.
 *
 * A week does not have to fit in one run. The cursor starts at this floor and
 * only moves forward, committing as it goes, so the window is covered across
 * however many runs it takes. Shrinking it to reach "caught up" sooner would
 * instead mean never seeing the positions in the part that was skipped — the
 * cursor never goes back.
 */
const FIRST_RUN_LOOKBACK_BLOCKS = 50_000n;

/** Re-read recent blocks so a reorg near the head cannot strand an event. */
const REORG_REPLAY_BLOCKS = 64n;

/**
 * Wall clock for the whole invocation, shared across all four passes.
 *
 * Budgeting each pass separately does not work: three scans at 25s each, plus a
 * deadline pass doing its own chain reads, ran for two and a half minutes and
 * was killed with WORKER_RESOURCE_LIMIT. A per-pass limit bounds a pass; only a
 * shared deadline bounds the run.
 *
 * Being cut short is not a failure. Every cursor is committed as its scan
 * proceeds, so the next run resumes rather than restarts — which is what lets
 * the first run, with a week of history to cover, converge over a few hours
 * instead of having to fit in one invocation.
 */
const TOTAL_BUDGET_MS = 40_000;

/**
 * Of that, the share the three log scans may use between them.
 *
 * The rest is held back for the deadline pass. Without a reserve the scans take
 * everything on any run with a backlog, and the deadline pass — the one that
 * tells people their money is recoverable — is exactly the part that never runs.
 */
const SCAN_BUDGET_MS = 30_000;

/** The contracts scanned each pass, in the order they are given time. */
const CONTRACT_COUNT = 4;

/**
 * Deadline rows handled per run.
 *
 * Each one costs a chain read and possibly an email. Small enough that a backlog
 * drains over several runs rather than pushing one run past the wall clock.
 */
const DEADLINE_BATCH = 25;

const ZERO = '0x0000000000000000000000000000000000000000';

type Admin = SupabaseClient;

const usd = (value: bigint) =>
  `$${Number(formatUnits(value, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

async function cursorFor(admin: Admin, contract: string, head: bigint): Promise<bigint> {
  const { data } = await admin
    .from('notification_scan_state')
    .select('scanned_through_block')
    .eq('contract', contract)
    .maybeSingle();
  if (!data) {
    const floor = head > FIRST_RUN_LOOKBACK_BLOCKS ? head - FIRST_RUN_LOOKBACK_BLOCKS : 0n;
    return floor;
  }
  const scanned = BigInt(data.scanned_through_block);
  return scanned > REORG_REPLAY_BLOCKS ? scanned - REORG_REPLAY_BLOCKS : 0n;
}

async function commitCursor(admin: Admin, contract: string, through: bigint): Promise<void> {
  const { error } = await admin.from('notification_scan_state').upsert(
    {
      contract,
      scanned_through_block: Number(through),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contract' },
  );
  if (error) throw error;
}

/** Records an open position so its expiry can be warned about later. */
async function watch(
  admin: Admin,
  kind: string,
  entityId: string,
  beneficiary: string,
  expiresAt: Date,
): Promise<void> {
  // Ignoring a conflict rather than updating: a position's deadline does not
  // change, and a replayed log must not reopen a watch already resolved.
  await admin.from('notification_watch').upsert(
    {
      kind,
      entity_id: entityId,
      beneficiary_wallet: beneficiary.toLowerCase(),
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: 'kind,entity_id,beneficiary_wallet', ignoreDuplicates: true },
  );
}

/** Closes every watch on a position, whoever the beneficiary was. */
async function resolveWatch(admin: Admin, kind: string, entityId: string): Promise<void> {
  await admin
    .from('notification_watch')
    .update({ resolved_at: new Date().toISOString() })
    .eq('kind', kind)
    .eq('entity_id', entityId)
    .is('resolved_at', null);
}

/**
 * Closes every auction watch for a gem, across rounds.
 *
 * Auction watches are keyed `gemId:startTime` because a re-opened auction is a
 * separate contest with separate bidders. Settlement ends all of them, and the
 * settlement event carries only the gem id — hence the prefix match.
 */
async function resolveAuctionWatches(admin: Admin, gemId: bigint): Promise<void> {
  await admin
    .from('notification_watch')
    .update({ resolved_at: new Date().toISOString() })
    .eq('kind', 'auction')
    .like('entity_id', `${gemId}:%`)
    .is('resolved_at', null);
}

/** Everyone with an open watch on this auction round, other than `except`. */
async function priorBidders(admin: Admin, round: string, except: string): Promise<string[]> {
  const { data } = await admin
    .from('notification_watch')
    .select('beneficiary_wallet')
    .eq('kind', 'auction')
    .eq('entity_id', round)
    .is('resolved_at', null);
  return (data ?? [])
    .map((row) => String(row.beneficiary_wallet))
    .filter((wallet) => wallet.toLowerCase() !== except.toLowerCase());
}

/**
 * Who should be told about something happening to a token.
 *
 * A listed token is held in escrow by the Marketplace, so `ownerOf` returns the
 * contract rather than a person. The seller recorded on the listing is the one
 * who can actually act.
 */
async function tokenHolder(chain: OperatorChain, tokenId: bigint): Promise<string | null> {
  const owner = (await chain.logsClient
    .readContract({
      address: dgeNftAddress(),
      abi: dgeNftAbi,
      functionName: 'ownerOf',
      args: [tokenId],
    })
    .catch(() => null)) as Address | null;
  if (!owner) return null;

  const market = marketplaceAddress();
  if (owner.toLowerCase() !== market.toLowerCase()) return owner;

  const listing = (await chain.logsClient
    .readContract({
      address: market,
      abi: marketplaceAbi,
      functionName: 'listings',
      args: [tokenId],
    })
    .catch(() => null)) as readonly [Address, bigint] | null;
  return listing && listing[0] !== ZERO ? listing[0] : null;
}

interface Counters {
  created: number;
  emailed: number;
  pushed: number;
}

async function send(
  admin: Admin,
  counters: Counters,
  input: Parameters<typeof notifyWallet>[1],
): Promise<void> {
  const result = await notifyWallet(admin, input);
  if (result.created) counters.created += 1;
  if (result.emailed) counters.emailed += 1;
  counters.pushed += result.pushed;
}

/** Below the platform's own worker timeout, so this answers rather than dies. */
const HARD_TIMEOUT_MS = 60_000;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('NOTIFY_SWEEP_SECRET')?.trim();
  if (!expected) return json({ error: 'Notification sweep is not configured' }, 503);
  if (request.headers.get('x-notify-sweep-secret') !== expected) {
    return json({ error: 'Forbidden' }, 403);
  }

  const phases = phaseLog();
  try {
    const swept = await withDeadline(HARD_TIMEOUT_MS, () => runSweep(phases));
    if (swept === TIMED_OUT) {
      return json(
        {
          error: 'Notification sweep exceeded its own time limit',
          // The phase after the last one recorded is the one that hung.
          elapsedMsByPhase: phases.marks,
        },
        504,
      );
    }
    return json(swept);
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Notification sweep failed') }, 500);
  }
});

async function runSweep(phases: PhaseLog): Promise<Record<string, unknown>> {
  {
    const admin = adminClient();
    const chain = operatorChain();

    const counters: Counters = { created: 0, emailed: 0, pushed: 0 };
    const behind: Record<string, string> = {};
    // One budget for the run, measured from before the first network call, so an
    // expensive first contract shortens the rest rather than overrunning it.
    const remaining = () => Math.max(0, TOTAL_BUDGET_MS - phases.elapsed());
    const mark = phases.mark;

    /*
     * An equal share of what is left, for each contract still to be scanned.
     *
     * Giving every scan the whole remaining budget starves the ones that come
     * after it: with a backlog the first contract simply takes all of it, and on
     * the first run that is precisely what happened — the marketplace advanced
     * 2,760 blocks while the swap escrow and the auction advanced none, and
     * would have kept advancing none on every run thereafter.
     */
    let scansLeft = CONTRACT_COUNT;
    const scanShare = () => {
      const left = Math.max(0, SCAN_BUDGET_MS - phases.elapsed());
      return Math.floor(left / scansLeft--);
    };

    const head = await chain.logsClient.getBlockNumber();
    mark('chain_head');

    // ---- Marketplace ------------------------------------------------------
    const marketFrom = await cursorFor(admin, 'marketplace', head);
    const marketResult = await scanLogs(chain, {
      address: marketplaceAddress(),
      from: marketFrom,
      to: head,
      budgetMs: scanShare(),
      onProgress: (through) => commitCursor(admin, 'marketplace', through),
      onLogs: async (logs: Log[]) => {
        for (const event of parseEventLogs({ abi: marketplaceAbi, logs: logs as never })) {
          if (event.eventName === 'OfferCreated') {
            const { offerId, bidder, tokenId, saleUsdValue, expiry } = event.args as {
              offerId: bigint;
              bidder: Address;
              tokenId: bigint;
              saleUsdValue: bigint;
              expiry: bigint;
            };
            const expiresAt = new Date(Number(expiry) * 1_000);
            // The bidder's money is what is at stake if this lapses unanswered.
            // Recorded even when already expired, so the deadline pass can still
            // tell the bidder their money is sitting there unclaimed.
            await watch(admin, 'offer', String(offerId), bidder, expiresAt);

            // Nothing to decide on an offer that has already lapsed. Offers last
            // 24 hours and the first run replays about a week, so without this
            // the owner's introduction to notifications would be a stack of
            // decisions that expired days ago.
            if (expiresAt.getTime() <= Date.now()) continue;

            const holder = await tokenHolder(chain, tokenId);
            if (!holder) continue;
            await send(admin, counters, {
              wallet: holder,
              kind: 'offer.received',
              title: `You have an offer of ${usd(saleUsdValue)}`,
              body:
                `Someone has offered ${usd(saleUsdValue)} for your gemstone token #${tokenId}. ` +
                `The money is already escrowed, so accepting is immediate — but the offer ` +
                `expires in 24 hours and the funds return to the bidder if you do nothing.`,
              actionPath: '/profile?tab=offers',
              actionLabel: 'Review the offer',
              entityType: 'offer',
              entityId: String(offerId),
              expiresAt,
            });
          }

          if (event.eventName === 'OfferAccepted' || event.eventName === 'OfferCancelled') {
            const { offerId } = event.args as { offerId: bigint };
            await resolveWatch(admin, 'offer', String(offerId));
          }
        }
      },
    });
    mark('marketplace');
    if (!marketResult.caughtUp) behind.marketplace = marketResult.blocksBehind.toString();

    // ---- Swap escrow ------------------------------------------------------
    const swapFrom = await cursorFor(admin, 'swap_escrow', head);
    const swapResult = await scanLogs(chain, {
      address: swapEscrowAddress(),
      from: swapFrom,
      to: head,
      budgetMs: scanShare(),
      onProgress: (through) => commitCursor(admin, 'swap_escrow', through),
      onLogs: async (logs: Log[]) => {
        for (const event of parseEventLogs({ abi: swapEscrowAbi, logs: logs as never })) {
          if (event.eventName === 'OfferCreated') {
            const { offerId, proposer, requestedTokenId, offeredTokenId, expiry } = event.args as {
              offerId: bigint;
              proposer: Address;
              requestedTokenId: bigint;
              offeredTokenId: bigint;
              expiry: bigint;
            };
            const expiresAt = new Date(Number(expiry) * 1_000);
            /*
             * The proposer's NFT is already in escrow — `createOffer` transfers
             * it in. If this expires, `acceptOffer` starts reverting and only
             * `cancelOffer`, which only they can call, gets it back. Nothing on
             * chain returns it automatically, so this watch is the only thing
             * standing between them and a token parked in a contract forever.
             */
            await watch(admin, 'swap', String(offerId), proposer, expiresAt);

            // As with offers: an expired proposal is not a decision anyone can
            // still make. The proposer is warned separately by the deadline pass,
            // because for them it is not a decision — it is a token to recover.
            if (expiresAt.getTime() <= Date.now()) continue;

            const holder = await tokenHolder(chain, requestedTokenId);
            if (!holder) continue;
            await send(admin, counters, {
              wallet: holder,
              kind: 'swap.received',
              title: 'Someone wants to swap for your gemstone',
              body:
                `A collector has offered their token #${offeredTokenId} in exchange for your ` +
                `#${requestedTokenId}. Their token is already held in escrow, so the trade ` +
                `settles the moment you accept.`,
              actionPath: '/swaps',
              actionLabel: 'Review the swap',
              entityType: 'swap',
              entityId: String(offerId),
              expiresAt,
            });
          }

          if (event.eventName === 'OfferAccepted' || event.eventName === 'OfferCancelled') {
            const { offerId } = event.args as { offerId: bigint };
            await resolveWatch(admin, 'swap', String(offerId));
          }
        }
      },
    });
    mark('swap_escrow');
    if (!swapResult.caughtUp) behind.swap_escrow = swapResult.blocksBehind.toString();

    // ---- Primary sale auction --------------------------------------------
    const auctionFrom = await cursorFor(admin, 'primary_sale', head);
    const auctionResult = await scanLogs(chain, {
      address: chain.addresses.primarySale,
      from: auctionFrom,
      to: head,
      budgetMs: scanShare(),
      onProgress: (through) => commitCursor(admin, 'primary_sale', through),
      onLogs: async (logs: Log[]) => {
        for (const event of parseEventLogs({ abi: primarySaleAbi, logs: logs as never })) {
          if (event.eventName === 'BidPlaced') {
            const { gemId, bidder } = event.args as { gemId: bigint; bidder: Address };
            const auction = (await chain.logsClient
              .readContract({
                address: chain.addresses.primarySale,
                abi: primarySaleAbi,
                functionName: 'auctions',
                args: [gemId],
              })
              .catch(() => null)) as
              readonly [boolean, boolean, bigint, bigint, bigint, Address, ...unknown[]] | null;
            if (!auction || !auction[0]) continue;
            /*
             * Only auctions still open. The first run replays about a week of
             * history to find live positions, and without this it would announce
             * to everyone who has ever been outbid that they have been outbid —
             * about contests that closed days ago, which they can do nothing
             * about. A notification system whose first act is a flood of stale
             * mail teaches people to ignore it.
             */
            if (auction[3] <= BigInt(Math.floor(Date.now() / 1_000))) continue;

            /*
             * Keyed by the round's start time, so being outbid three times in
             * one auction is one message rather than three, and a re-opened
             * auction the next day is legitimately a new one.
             */
            const round = `${gemId}:${auction[2]}`;

            // Read before recording this bidder, so they are not in their own
            // list of people to tell.
            const outbid = await priorBidders(admin, round, bidder);
            await watch(admin, 'auction', round, bidder, new Date(Number(auction[3]) * 1_000));

            for (const wallet of outbid) {
              await send(admin, counters, {
                wallet,
                kind: 'auction.outbid',
                title: 'You have been outbid',
                body:
                  `Someone has bid higher than you on gemstone #${gemId}. You can still bid ` +
                  `again before the auction closes. If you do not, your payment stays with ` +
                  `the contract as a claimable refund — it is not returned automatically.`,
                actionPath: '/auctions',
                actionLabel: 'View the auction',
                entityType: 'auction-round',
                entityId: round,
              });
            }
          }

          if (event.eventName === 'AuctionSettled') {
            const { gemId, tokenId, winner } = event.args as {
              gemId: bigint;
              tokenId: bigint;
              winner: Address;
            };
            await resolveAuctionWatches(admin, gemId);
            if (winner === ZERO) continue;
            await send(admin, counters, {
              wallet: winner,
              kind: 'auction.won',
              title: 'You won the auction',
              body:
                `Gemstone #${gemId} has been minted to you as token #${tokenId}. It is in your ` +
                `wallet now — you can list it, swap it, gift it, or redeem the physical stone.`,
              actionPath: '/profile',
              actionLabel: 'View your gemstone',
              entityType: 'gem',
              entityId: String(gemId),
            });
          }

          if (event.eventName === 'AuctionSettlementRefunded') {
            const { gemId, bidder } = event.args as { gemId: bigint; bidder: Address };
            /*
             * Winning and then being refunded is the most confusing outcome the
             * protocol produces — the auction ended, no token arrived, and the
             * money is not back in the wallet either. Worth saying plainly.
             *
             * The amount is deliberately not quoted: it is denominated in
             * whichever payment asset was used, and printing raw token units
             * next to a currency symbol would be worse than saying nothing.
             */
            await send(admin, counters, {
              wallet: bidder,
              kind: 'auction.refunded',
              title: 'Your winning bid was refunded',
              body:
                `The auction for gemstone #${gemId} could not be settled — usually a reserve ` +
                `shortfall — so no token was minted and your payment was returned. It is held ` +
                `as a claimable refund rather than sent back automatically.`,
              actionPath: '/auctions',
              actionLabel: 'Claim your refund',
              entityType: 'gem',
              entityId: String(gemId),
            });
          }
        }
      },
    });
    mark('primary_sale');
    if (!auctionResult.caughtUp) behind.primary_sale = auctionResult.blocksBehind.toString();

    // ---- Redemption manager ----------------------------------------------
    const redemptionFrom = await cursorFor(admin, 'redemption_manager', head);
    const redemptionResult = await scanLogs(chain, {
      address: redemptionManagerAddress(),
      from: redemptionFrom,
      to: head,
      budgetMs: scanShare(),
      commitEvery: 10,
      onProgress: (through) => commitCursor(admin, 'redemption_manager', through),
      onLogs: async (logs: Log[]) => {
        for (const event of parseEventLogs({ abi: redemptionManagerAbi, logs: logs as never })) {
          const { tokenId, gemId } = event.args as { tokenId: bigint; gemId: bigint };

          if (event.eventName === 'RedemptionOpened') {
            const { owner } = event.args as { owner: Address };
            /*
             * The custodian is the whole point of this branch. Redemption stops
             * dead until they call `confirmRedemption`, and nothing else can do
             * it for them — so this is the message that turns a request into a
             * shipment rather than a row that sits at "in progress" forever.
             */
            const gem = (await chain.logsClient
              .readContract({
                address: chain.addresses.registry,
                abi: gemRegistryAbi,
                functionName: 'getGem',
                args: [gemId],
              })
              .catch(() => null)) as { custodian: Address } | null;
            if (gem?.custodian && gem.custodian !== ZERO) {
              await send(admin, counters, {
                wallet: gem.custodian,
                kind: 'redemption.opened',
                title: 'A redemption is waiting on you',
                body:
                  `The owner of gemstone #${gemId} has asked to take physical delivery. The ` +
                  `token is locked until this is settled. Once the stone is with them, confirm ` +
                  `the handover — nobody else can, and the reserve is released to you when you do.`,
                actionPath: '/profile?tab=redeem',
                actionLabel: 'Review the redemption',
                entityType: 'redemption',
                entityId: String(tokenId),
              });
            }

            // And the owner, so "in progress" has a known counterparty.
            await send(admin, counters, {
              wallet: owner,
              kind: 'redemption.requested',
              title: 'Your redemption request is open',
              body:
                `Gemstone #${gemId} is now awaiting custodian fulfilment, and the token is ` +
                `locked while that runs. You can cancel at any time to unlock it.`,
              actionPath: '/profile?tab=redeem',
              actionLabel: 'Track your redemption',
              entityType: 'redemption',
              entityId: String(tokenId),
            });
          }

          if (
            event.eventName === 'RedemptionConfirmed' ||
            event.eventName === 'RedemptionCancelled'
          ) {
            /*
             * Neither event carries the owner — only `(tokenId, gemId)` — and by
             * now the token is burned, so `ownerOf` cannot answer either. The
             * notification written when the request opened is the surviving
             * record of who asked, so that is what is read back.
             *
             * A request opened before this sweep existed has no such row. Those
             * are skipped rather than addressed to the zero address, which would
             * quietly accumulate notifications nobody can ever read.
             */
            const { data: opened } = await admin
              .from('notifications')
              .select('wallet_address')
              .eq('kind', 'redemption.requested')
              .eq('entity_type', 'redemption')
              .eq('entity_id', String(tokenId))
              .maybeSingle();
            if (!opened?.wallet_address) continue;

            const confirmed = event.eventName === 'RedemptionConfirmed';
            await send(admin, counters, {
              wallet: String(opened.wallet_address),
              kind: confirmed ? 'redemption.confirmed' : 'redemption.cancelled',
              title: confirmed
                ? 'Your gemstone has been released'
                : 'Your redemption was cancelled',
              body: confirmed
                ? `The custodian has confirmed physical handover of gemstone #${gemId}. The ` +
                  `token has been burned and the reserve released — the stone is yours outright.`
                : `The redemption request for gemstone #${gemId} was cancelled. The token is ` +
                  `unlocked and back to normal, and you can request redemption again whenever ` +
                  `you like.`,
              actionPath: '/profile',
              entityType: 'redemption',
              entityId: String(tokenId),
            });
          }
        }
      },
    });
    mark('redemption_manager');
    if (!redemptionResult.caughtUp) {
      behind.redemption_manager = redemptionResult.blocksBehind.toString();
    }

    // ---- Deadlines --------------------------------------------------------
    // Runs on whatever time is left. Skipping it entirely on a heavy catch-up
    // run is fine: watches stay unresolved and the next run picks them up.
    const deadlines = await sweepDeadlines(admin, chain, counters, remaining);
    mark('deadlines');

    return {
      notificationsCreated: counters.created,
      emailsSent: counters.emailed,
      pushesSent: counters.pushed,
      deadlinesChecked: deadlines,
      scannedThroughBlock: {
        marketplace: marketResult.scannedThrough.toString(),
        swap_escrow: swapResult.scannedThrough.toString(),
        primary_sale: auctionResult.scannedThrough.toString(),
        redemption_manager: redemptionResult.scannedThrough.toString(),
      },
      elapsedMsByPhase: phases.marks,
      caughtUp: Object.keys(behind).length === 0,
      blocksBehind: behind,
    };
  }
}

/**
 * Warns the people whose positions have lapsed, or are about to.
 *
 * Each watch is verified against the chain before anything is sent. The row says
 * a position was opened; only the contract knows whether it is still open, and
 * telling someone to recover an asset they already recovered is worse than
 * saying nothing.
 */
async function sweepDeadlines(
  admin: Admin,
  chain: OperatorChain,
  counters: Counters,
  remaining: () => number,
): Promise<number> {
  if (remaining() <= 0) return 0;

  const { data: due } = await admin
    .from('notification_watch')
    .select('id,kind,entity_id,beneficiary_wallet,expires_at')
    .is('resolved_at', null)
    .lt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(DEADLINE_BATCH);

  if (!due?.length) return 0;

  let handled = 0;
  for (const row of due) {
    // Checked per row, not just up front: each one is a chain read and possibly
    // an email, and the row stays unresolved so the next run continues here.
    if (remaining() <= 0) break;
    handled += 1;
    const entityId = String(row.entity_id);
    const wallet = String(row.beneficiary_wallet);
    let stillOpen = false;

    if (row.kind === 'offer') {
      const offer = (await chain.logsClient
        .readContract({
          address: marketplaceAddress(),
          abi: marketplaceAbi,
          functionName: 'offers',
          args: [BigInt(entityId)],
        })
        .catch(() => null)) as
        readonly [Address, bigint, Address, bigint, bigint, bigint, boolean] | null;
      stillOpen = Boolean(offer?.[6]);
      if (stillOpen) {
        await send(admin, counters, {
          wallet,
          kind: 'offer.refundable',
          title: 'Your offer expired — claim your money back',
          body:
            `The owner did not respond before your offer expired, so your payment is still ` +
            `held by the Marketplace contract. It is not returned automatically: claim the ` +
            `refund to get it back.`,
          actionPath: '/profile?tab=offers',
          actionLabel: 'Claim your refund',
          entityType: 'offer',
          entityId,
        });
      }
    } else if (row.kind === 'swap') {
      const offer = (await chain.logsClient
        .readContract({
          address: swapEscrowAddress(),
          abi: swapEscrowAbi,
          functionName: 'offers',
          args: [BigInt(entityId)],
        })
        .catch(() => null)) as
        readonly [Address, bigint, bigint, Address, bigint, boolean, bigint, boolean] | null;
      stillOpen = Boolean(offer?.[7]);
      if (stillOpen) {
        await send(admin, counters, {
          wallet,
          kind: 'swap.recoverable',
          title: 'Your gemstone is still locked in a swap',
          body:
            `Your swap proposal expired without being accepted, and your token is still held ` +
            `in escrow. Nothing returns it automatically and nobody else can release it — ` +
            `cancel the swap to get your gemstone back.`,
          actionPath: '/swaps',
          actionLabel: 'Cancel and recover',
          entityType: 'swap',
          entityId,
        });
      }
    } else if (row.kind === 'auction') {
      /*
       * Nothing to send. Being outbid is told at the moment it happens, in the
       * event pass, while there is still time to bid again — a message that
       * arrives after the auction closed would be news about a decision the
       * recipient can no longer make. A losing bidder's refund is surfaced in
       * the app on both the auctions and portfolio pages.
       *
       * The row is here only so the watch stops being open once the round ends.
       */
    }

    // Resolved either way. A position that closed needs no warning, and one that
    // was warned about needs no second warning.
    await admin
      .from('notification_watch')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', row.id);
  }

  return handled;
}
