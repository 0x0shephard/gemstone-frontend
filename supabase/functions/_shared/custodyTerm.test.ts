import { describe, expect, it } from 'vitest';
import { CustodyTermInputError, parseCustodyTermInput } from './custodyTerm';

const NOW = Date.parse('2026-10-02T00:00:00.000Z');

describe('custody term attestation', () => {
  it('accepts an explicit, future, evidenced term', () => {
    expect(
      parseCustodyTermInput(
        {
          gemId: '003',
          reserveEscrowEndsAt: '2027-12-31T23:59:59.000Z',
          attestationNote: 'Verified against custody agreement DC-003.',
          attestAccurate: true,
        },
        NOW,
      ),
    ).toEqual({
      gemId: '3',
      reserveEscrowEndsAt: '2027-12-31T23:59:59.000Z',
      attestationNote: 'Verified against custody agreement DC-003.',
    });
  });

  it.each([
    [{ gemId: '3', attestationNote: 'Agreement DC-003', attestAccurate: true }, 'Record the date'],
    [
      {
        gemId: '3',
        reserveEscrowEndsAt: '2026-10-01T00:00:00.000Z',
        attestationNote: 'Agreement DC-003',
        attestAccurate: true,
      },
      'must be in the future',
    ],
    [
      {
        gemId: '3',
        reserveEscrowEndsAt: '2027-12-31T23:59:59.000Z',
        attestationNote: 'short',
        attestAccurate: true,
      },
      'Describe the custody agreement',
    ],
    [
      {
        gemId: '3',
        reserveEscrowEndsAt: '2027-12-31T23:59:59.000Z',
        attestationNote: 'Agreement DC-003',
        attestAccurate: false,
      },
      'Confirm that this is the actual',
    ],
  ])('refuses to infer or weakly attest a term', (input, message) => {
    const parse = () => parseCustodyTermInput(input, NOW);
    expect(parse).toThrow(CustodyTermInputError);
    expect(parse).toThrow(message);
  });
});
