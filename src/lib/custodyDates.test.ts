import { describe, expect, it } from 'vitest';
import { custodyDatesProblem } from './custodyDates';

const now = new Date('2026-10-09T17:13:00Z');
const at = (iso: string) => new Date(iso);

describe('custodyDatesProblem', () => {
  it('accepts observed dates in order', () => {
    expect(
      custodyDatesProblem(
        {
          receivedAt: at('2026-10-09T17:11:00Z'),
          custodyStartedAt: at('2026-10-09T17:12:00Z'),
          agreementEndsAt: at('2030-11-03T17:11:00Z'),
        },
        now,
      ),
    ).toBeUndefined();
  });

  it('names a custody start in the future (the 2026-10-09 report)', () => {
    expect(
      custodyDatesProblem(
        {
          receivedAt: at('2026-10-09T17:11:00Z'),
          custodyStartedAt: at('2026-10-10T18:11:00Z'),
          agreementEndsAt: at('2030-11-03T17:11:00Z'),
        },
        now,
      ),
    ).toMatch(/"Custody started at" is in the future/);
  });

  it('names custody starting before arrival and an agreement ending too early', () => {
    expect(
      custodyDatesProblem(
        {
          receivedAt: at('2026-10-09T17:11:00Z'),
          custodyStartedAt: at('2026-10-09T17:00:00Z'),
          agreementEndsAt: at('2030-11-03T17:11:00Z'),
        },
        now,
      ),
    ).toMatch(/before "Received at"/);
    expect(
      custodyDatesProblem(
        {
          receivedAt: at('2026-10-09T17:11:00Z'),
          custodyStartedAt: at('2026-10-09T17:12:00Z'),
          agreementEndsAt: at('2026-10-09T17:12:00Z'),
        },
        now,
      ),
    ).toMatch(/must be after "Custody started at"/);
  });
});
