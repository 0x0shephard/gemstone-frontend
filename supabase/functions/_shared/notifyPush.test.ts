// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendPush = vi.hoisted(() => vi.fn());
vi.mock('./webpush.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./webpush.ts')>();
  return { ...actual, pushConfigured: () => true, sendPush };
});

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { PUSH_CONCURRENCY, forEachConcurrently, notifyWallet } from './notify.ts';
import { PushEndpointRejectedError } from './webpush.ts';

const WALLET = '0x1111111111111111111111111111111111111111';

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  values?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

/**
 * Just enough of the supabase-js query builder for `notifyWallet`: every chain
 * resolves to whatever `respond` returns for the finished call.
 */
function fakeAdmin(respond: (call: Call) => { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = () => chain();
    builder.insert = (values: Record<string, unknown>) => {
      call.op = 'insert';
      call.values = values;
      return chain();
    };
    builder.update = (values: Record<string, unknown>) => {
      call.op = 'update';
      call.values = values;
      return chain();
    };
    for (const name of ['eq', 'is', 'in', 'order', 'limit']) {
      builder[name] = (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain();
      };
    }
    const finish = () => {
      calls.push(call);
      return Promise.resolve(respond(call));
    };
    builder.maybeSingle = finish;
    builder.single = finish;
    builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      finish().then(resolve, reject);
    return builder;
  };
  return { admin: { from } as unknown as SupabaseClient, calls };
}

const input = {
  wallet: WALLET,
  kind: 'offer.received',
  title: 'New offer',
  body: 'Someone made an offer.',
  entityType: 'offer',
  entityId: '7',
};

const devices = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `device-${index}`,
    endpoint: `https://fcm.googleapis.com/fcm/send/${index}`,
    p256dh: 'key',
    auth: 'secret',
  }));

function respondWith(link: Record<string, unknown> | null, deviceRows = devices(0)) {
  return (call: Call) => {
    if (call.table === 'wallet_links') return { data: link, error: null };
    if (call.table === 'notifications' && call.op === 'insert') {
      return { data: { id: 'notification-1' }, error: null };
    }
    if (call.table === 'push_subscriptions' && call.op === 'select') {
      return { data: deviceRows, error: null };
    }
    return { data: null, error: null };
  };
}

describe('forEachConcurrently', () => {
  it('never runs more than the cap at once, and runs everything', async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await forEachConcurrently([...Array(10).keys()], 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      done.push(item);
    });
    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([...Array(10).keys()]);
  });

  it('keeps going past a failing task', async () => {
    const seen: number[] = [];
    await forEachConcurrently([1, 2, 3], 2, async (item) => {
      seen.push(item);
      if (item === 1) throw new Error('boom');
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('notifyWallet push delivery', () => {
  const environment = new Map<string, string>([
    ['CHAIN_ID', '42161'],
    ['PROTOCOL_DEPLOYMENT_ID', 'arbitrum-one-519342582'],
  ]);

  beforeEach(() => {
    sendPush.mockReset();
    vi.stubGlobal('Deno', { env: { get: (name: string) => environment.get(name) } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('pushes devices concurrently, capped, so one slow device does not serialize the rest', async () => {
    let active = 0;
    let peak = 0;
    sendPush.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    });
    const { admin } = fakeAdmin(
      respondWith({ profile_id: 'profile-1', chain_id: 42161, signature_kind: null }, devices(9)),
    );

    const result = await notifyWallet(admin, input);

    expect(result.pushed).toBe(9);
    expect(sendPush).toHaveBeenCalledTimes(9);
    expect(peak).toBe(PUSH_CONCURRENCY);
  });

  it('retires a device whose endpoint is off the allowlist', async () => {
    sendPush.mockRejectedValue(new PushEndpointRejectedError());
    const { admin, calls } = fakeAdmin(
      respondWith({ profile_id: 'profile-1', chain_id: 42161, signature_kind: 'eoa' }, devices(1)),
    );

    await notifyWallet(admin, input);

    const retire = calls.find(
      (call) => call.table === 'push_subscriptions' && call.op === 'update',
    );
    expect(retire?.values).toHaveProperty('expired_at');
    expect(retire?.filters).toContainEqual(['id', 'device-0']);
  });

  it('does not deliver to a contract-wallet link proven on another chain', async () => {
    const { admin, calls } = fakeAdmin(
      respondWith(
        { profile_id: 'profile-1', chain_id: 11155111, signature_kind: 'contract' },
        devices(2),
      ),
    );

    const result = await notifyWallet(admin, input);

    expect(result).toMatchObject({ created: true, pushed: 0, reason: 'no-account' });
    const insert = calls.find((call) => call.table === 'notifications' && call.op === 'insert');
    expect(insert?.values?.profile_id).toBeNull();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('still delivers to an EOA link proven on another chain', async () => {
    sendPush.mockResolvedValue(undefined);
    const { admin } = fakeAdmin(
      respondWith(
        { profile_id: 'profile-1', chain_id: 11155111, signature_kind: 'eoa' },
        devices(1),
      ),
    );
    await expect(notifyWallet(admin, input)).resolves.toMatchObject({ pushed: 1 });
  });
});
