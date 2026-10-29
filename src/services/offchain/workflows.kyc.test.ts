import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  user: { id: 'profile-1', is_anonymous: false } as { id: string; is_anonymous?: boolean } | null,
  row: { data: null as unknown, error: null as unknown },
  queries: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>,
}));

vi.mock('./invoke', () => ({
  invokeEdgeFunction: invoke,
  requireClient: () => ({
    auth: { getUser: async () => ({ data: { user: client.user } }) },
    from: (table: string) => {
      const query = { table, columns: '', filters: [] as Array<[string, unknown]> };
      client.queries.push(query);
      const builder = {
        select: (columns: string) => {
          query.columns = columns;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          query.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => client.row,
      };
      return builder;
    },
  }),
}));

import { beginKyc, getKycStatus, issueSumsubToken } from './workflows';

describe('getKycStatus', () => {
  beforeEach(() => {
    client.user = { id: 'profile-1', is_anonymous: false };
    client.row = { data: null, error: null };
    client.queries = [];
  });

  it('reads the caller’s row in kyc_profiles, the table the webhook writes', async () => {
    client.row = { data: { status: 'approved' }, error: null };
    await expect(getKycStatus()).resolves.toBe('approved');
    expect(client.queries).toEqual([
      { table: 'kyc_profiles', columns: 'status', filters: [['profile_id', 'profile-1']] },
    ]);
  });

  it('is not_started with no row, no user, an anonymous user or an unknown value', async () => {
    await expect(getKycStatus()).resolves.toBe('not_started');
    client.row = { data: { status: 'none' }, error: null };
    await expect(getKycStatus()).resolves.toBe('not_started');
    client.user = { id: 'anon', is_anonymous: true };
    await expect(getKycStatus()).resolves.toBe('not_started');
    client.user = null;
    await expect(getKycStatus()).resolves.toBe('not_started');
  });

  it('surfaces a failed read instead of reporting an unverified account', async () => {
    client.row = { data: null, error: { message: 'permission denied' } };
    await expect(getKycStatus()).rejects.toThrow('Could not load your verification status.');
  });
});

describe('beginKyc', () => {
  beforeEach(() => invoke.mockReset());

  it('returns what the Sumsub WebSDK needs, including a refresher for expiry', async () => {
    invoke
      .mockResolvedValueOnce({ token: 'sbx:first', expiresIn: 600 })
      .mockResolvedValueOnce({ token: 'sbx:second', expiresIn: 600 });
    const before = Date.now();

    const session = await beginKyc();

    expect(invoke).toHaveBeenCalledWith('v1-sumsub-token');
    expect(session.accessToken).toBe('sbx:first');
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    await expect(session.refreshToken()).resolves.toBe('sbx:second');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('refuses a response without a token', async () => {
    invoke.mockResolvedValueOnce({ expiresIn: 600 });
    await expect(issueSumsubToken()).rejects.toThrow('Identity verification could not be started');
  });

  it('passes the server’s error through', async () => {
    invoke.mockRejectedValueOnce(new Error('Identity verification is not configured'));
    await expect(beginKyc()).rejects.toThrow('Identity verification is not configured');
  });
});
