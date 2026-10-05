import { describe, expect, it } from 'vitest';
import { staffNavigation } from './navigation';
import type { OperationsAccess } from '@/services/offchain/operations';

function access(capabilities: OperationsAccess['capabilities']): OperationsAccess {
  return {
    capabilities,
    memberships: [
      {
        organizationId: 'organization',
        name: 'Operations partner',
        kind: 'admin',
        role: 'member',
        capabilities,
      },
    ],
  };
}

describe('staff navigation disclosure', () => {
  it('does not reveal any operational route without verified access', () => {
    expect(staffNavigation(null)).toEqual([]);
  });

  it('reveals only routes backed by an exact capability', () => {
    expect(staffNavigation(access(['bank.receive', 'admin.read'])).map((item) => item.to)).toEqual([
      '/bank',
      '/verify',
    ]);
  });
});
