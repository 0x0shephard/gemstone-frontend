import { beforeEach, describe, expect, it } from 'vitest';
import { getTransactionAuthSnapshot, setTransactionAuthSnapshot } from './authSnapshot';

describe('transaction auth snapshot', () => {
  beforeEach(() => {
    setTransactionAuthSnapshot({ loading: true, userId: null, linkedWallet: null });
  });

  it('makes the verified wallet available synchronously to transaction preflight', () => {
    setTransactionAuthSnapshot({
      loading: false,
      userId: 'profile-1',
      linkedWallet: '0x0000000000000000000000000000000000000001',
    });

    expect(getTransactionAuthSnapshot()).toEqual({
      loading: false,
      userId: 'profile-1',
      linkedWallet: '0x0000000000000000000000000000000000000001',
    });
  });
});
