import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const lifecycle = readFileSync(
  join(process.cwd(), 'supabase/functions/v1-redemption-lifecycle/index.ts'),
  'utf8',
);
const reconcile = lifecycle.slice(
  lifecycle.indexOf("if (action === 'reconcile_onchain_request')"),
  lifecycle.indexOf("if (action === 'discard_redemption')"),
);

describe('redemption opening reconciliation', () => {
  it('is owner-only and only for a request still at committed', () => {
    expect(reconcile).toContain("if (!owner || row.status !== 'committed')");
  });

  it('records nothing unless the chain shows this exact workflow open', () => {
    const check = reconcile.indexOf('readRedemptionRecord(');
    const find = reconcile.indexOf('findOpeningTransaction(');
    const record = reconcile.indexOf('recordOnchainRequested(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(find);
    expect(find).toBeLessThan(record);
    expect(reconcile).toContain('record.phase === ChainPhase.None');
    expect(reconcile).toContain('workflowIdHash(requestId).toLowerCase()');
    expect(reconcile).toContain('reconciled: false');
  });

  it('verifies the found transaction exactly as a browser-reported one', () => {
    const shared = lifecycle.slice(
      lifecycle.indexOf('const recordOnchainRequested = async'),
      lifecycle.indexOf("if (action === 'mark_onchain_requested')"),
    );
    expect(shared).toContain("findEvent(chain.logs, 'RedemptionOpened')");
    expect(shared).toContain("assertEventValue(opened.args.owner, row.requester_wallet, 'owner')");
    expect(shared).toContain("toState: 'onchain_requested'");
    expect(lifecycle).toContain(
      'await recordOnchainRequested(requiredHash(body.transactionHash), action)',
    );
  });
});
