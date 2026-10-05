import { describe, expect, it } from 'vitest';
import { stableRecoveryEligibleAt } from './approvalIntent';

describe('approval intent recovery deadline', () => {
  it('reuses the prepared value when the mined transaction is confirmed later', () => {
    const prepared = stableRecoveryEligibleAt(null, 604_800, Date.UTC(2026, 9, 5));
    const confirmed = stableRecoveryEligibleAt(
      { recoveryEligibleAt: prepared },
      604_800,
      Date.UTC(2026, 9, 5, 0, 5),
    );

    expect(confirmed).toBe(prepared);
  });

  it('does not reuse an invalid persisted deadline', () => {
    expect(
      stableRecoveryEligibleAt({ recoveryEligibleAt: 'not-a-date' }, 60, Date.UTC(2026, 9, 5)),
    ).toBe('2026-10-05T00:01:00.000Z');
  });
});
