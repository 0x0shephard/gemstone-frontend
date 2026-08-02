import { adminClient } from '../_shared/auth.ts';
import { safeErrorMessage } from '../_shared/errors.ts';
import { json, preflight } from '../_shared/cors.ts';
import { currentDemand, ingestBidEvents, DEFAULT_WINDOW_DAYS } from '../_shared/demand.ts';
import { totalFor } from '../_shared/demandMath.ts';

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

  try {
    const admin = adminClient();
    const { scannedThrough, inserted } = await ingestBidEvents(admin);
    const demand = await currentDemand(admin);
    return json({
      scannedThroughBlock: scannedThrough.toString(),
      newBids: inserted,
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
