export interface CustodyTermInput {
  gemId: string;
  reserveEscrowEndsAt: string;
  attestationNote: string;
}

export class CustodyTermInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustodyTermInputError';
  }
}

/**
 * Validates an explicit custodian attestation for a tokenised stone whose
 * original intake record is unavailable (for example, pre-workflow demo
 * inventory). The end date is never defaulted or derived: only the real term
 * supplied by a custodian may become a gift-card expiry.
 */
export function parseCustodyTermInput(
  body: Record<string, unknown>,
  now = Date.now(),
): CustodyTermInput {
  const gemId = String(body.gemId ?? '').trim();
  if (!/^\d+$/.test(gemId) || BigInt(gemId) <= 0n) {
    throw new CustodyTermInputError('A positive numeric gemstone id is required');
  }

  const reserveEscrowEndsAt = new Date(String(body.reserveEscrowEndsAt ?? ''));
  if (Number.isNaN(reserveEscrowEndsAt.getTime())) {
    throw new CustodyTermInputError('Record the date this stone’s reserve escrow ends');
  }
  if (reserveEscrowEndsAt.getTime() <= now) {
    throw new CustodyTermInputError('The reserve escrow end date must be in the future');
  }

  const attestationNote =
    typeof body.attestationNote === 'string' ? body.attestationNote.trim() : '';
  if (attestationNote.length < 10) {
    throw new CustodyTermInputError(
      'Describe the custody agreement or source used to verify this end date',
    );
  }
  if (attestationNote.length > 2_000) {
    throw new CustodyTermInputError('The custody-term note must be 2000 characters or fewer');
  }
  if (body.attestAccurate !== true) {
    throw new CustodyTermInputError('Confirm that this is the actual custody agreement end date');
  }

  return {
    gemId: BigInt(gemId).toString(),
    reserveEscrowEndsAt: reserveEscrowEndsAt.toISOString(),
    attestationNote,
  };
}
