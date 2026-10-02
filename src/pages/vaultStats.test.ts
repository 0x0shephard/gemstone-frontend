import { describe, expect, it } from 'vitest';
import { displayVaultCount } from './vaultStats';

describe('displayVaultCount', () => {
  it('preserves an authoritative empty deployment count', () => {
    expect(displayVaultCount(0)).toBe(0);
  });

  it('uses a neutral placeholder while the live count is unavailable', () => {
    expect(displayVaultCount(undefined)).toBe('—');
  });

  it('displays the live value without a demo fallback', () => {
    expect(displayVaultCount(17)).toBe(17);
  });
});
