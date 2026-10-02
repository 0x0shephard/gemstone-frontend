/**
 * Never substitute demo inventory for a live read that has not completed.
 * Zero is a real protocol value; an em dash means the value is unavailable.
 */
export function displayVaultCount(count: number | undefined): number | '—' {
  return count ?? '—';
}
