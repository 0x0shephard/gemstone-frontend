import { adminClient } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { currentDemand, ingestBidEvents, DEFAULT_WINDOW_DAYS } from '../_shared/demand.ts';
import { totalFor } from '../_shared/demandMath.ts';
import { TIMED_OUT, phaseLog, withDeadline } from '../_shared/deadline.ts';

/** Below the platform's own worker timeout, so this answers rather than dies. */
const HARD_TIMEOUT_MS = 60_000;

/**
 * Refreshes observed bid demand.
 *
 * Intended for a schedule rather than a user. There is no Supabase session
 * check: the function is protected by requiring a shared secret, so a cron
 * caller needs no user identity. Never expose this to the browser — it performs
 * a full chain scan.
 *
 * Idempotent. Running it twice ingests nothing new the second time.
 */
Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('DEMAND_REFRESH_SECRET')?.trim();
  if (!expected) return json({ error: 'Demand refresh is not configured' }, 503);
  if (request.headers.get('x-demand-refresh-secret') !== expected) {
    return json({ error: 'Forbidden' }, 403);
  }

  const phases = phaseLog();
  try {
    const admin = adminClient();

    /*
     * A full chain scan against an RPC that stops answering will otherwise sit
     * here until the platform tears the worker down, and WORKER_RESOURCE_LIMIT
     * is all the caller ever sees — no partial result, and no clue which call
     * hung. That is how a misconfigured logs RPC passed for eight days as a
     * generic "not enough compute resources".
     *
     * Abandoning the scan costs nothing: the cursor is committed as it goes, so
     * whatever this pass covered is kept and the rest is retried next run.
     */
    const ingested = await withDeadline(HARD_TIMEOUT_MS, () =>
      ingestBidEvents(admin, undefined, { phases }),
    );
    if (ingested === TIMED_OUT) {
      return json(
        {
          error: 'Demand ingest exceeded its own time limit',
          // The phase after the last one recorded is the one that hung.
          elapsedMsByPhase: phases.marks,
        },
        504,
      );
    }
    const { scannedThrough, inserted, caughtUp, blocksBehind } = ingested;
    phases.mark('ingest');
    const demand = await currentDemand(admin);
    phases.mark('aggregate');
    return json({
      scannedThroughBlock: scannedThrough.toString(),
      newBids: inserted,
      // A pass that ran out of budget is reported rather than presented as a
      // clean sweep. Without this the caller cannot tell "nothing to do" from
      // "still tens of thousands of blocks behind", which is the difference
      // between a healthy job and one that will never catch up.
      caughtUp,
      blocksBehind: blocksBehind.toString(),
      elapsedMsByPhase: phases.marks,
      windowDays: DEFAULT_WINDOW_DAYS,
      observed: {
        shape: totalFor(demand, 'shape'),
        color: totalFor(demand, 'color'),
        colorGrade: totalFor(demand, 'colorGrade'),
      },
    });
  } catch (error) {
    return json({ error: safeErrorMessage(error, 'Demand refresh failed') }, 500);
  }
});
