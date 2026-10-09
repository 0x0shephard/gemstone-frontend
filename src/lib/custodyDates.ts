/**
 * Why a vault custodian receipt's dates would be refused, or undefined when
 * they are acceptable. Mirrors `record_bank_receipt` and
 * `supabase/functions/_shared/custodyDates.ts`: dates are what was observed, so
 * neither arrival nor the start of custody may lie in the future (five minutes
 * of clock skew allowed), custody cannot start before the stone arrived, and
 * the agreement must end after custody starts.
 */
export function custodyDatesProblem(
  input: { receivedAt: Date; custodyStartedAt: Date; agreementEndsAt: Date },
  now: Date = new Date(),
): string | undefined {
  const latest = now.getTime() + 5 * 60_000;
  if (input.receivedAt.getTime() > latest) {
    return '"Received at" is in the future. Record when the stone actually arrived.';
  }
  if (input.custodyStartedAt.getTime() < input.receivedAt.getTime()) {
    return '"Custody started at" is before "Received at". Custody cannot start before arrival.';
  }
  if (input.custodyStartedAt.getTime() > latest) {
    return '"Custody started at" is in the future. Use the time custody actually began (now or earlier).';
  }
  if (input.agreementEndsAt.getTime() <= input.custodyStartedAt.getTime()) {
    return '"Custody agreement ends" must be after "Custody started at".';
  }
  return undefined;
}
