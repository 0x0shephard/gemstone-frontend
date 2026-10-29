// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_TIMEOUT_MS,
  PushEndpointRejectedError,
  PushGoneError,
  isAllowedPushEndpoint,
  sendPush,
  type PushSubscription,
} from './webpush.ts';

const b64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const environment = new Map<string, string>();
const fetchMock = vi.fn<typeof fetch>();
let device: Omit<PushSubscription, 'endpoint'>;

beforeAll(async () => {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey));
  environment.set('VAPID_PUBLIC_KEY', b64url(vapidPublic));
  environment.set('VAPID_PRIVATE_KEY', String(jwk.d));

  const client = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  device = {
    p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', client.publicKey))),
    auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
});

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://fcm.googleapis.com/wp/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
    'https://web.push.apple.com/QGx0',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['an internal address', 'https://169.254.169.254/latest/meta-data'],
    ['localhost', 'https://localhost/push'],
    ['a look-alike suffix', 'https://fcm.googleapis.com.evil.example/x'],
    ['a look-alike prefix', 'https://evilfcm.googleapis.com.example/x'],
    ['an unrelated host ending in the name', 'https://notpush.apple.com.example/x'],
    ['credentials', 'https://fcm.googleapis.com@evil.example/x'],
    ['user info on an allowed host', 'https://user:pass@fcm.googleapis.com/x'],
    ['a port', 'https://fcm.googleapis.com:8443/x'],
    ['not a URL', 'fcm.googleapis.com/x'],
    ['an oversized URL', `https://fcm.googleapis.com/${'a'.repeat(2_100)}`],
  ])('refuses %s', (_label, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('sendPush', () => {
  beforeEach(() => {
    vi.stubGlobal('Deno', { env: { get: (name: string) => environment.get(name) } });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const message = { title: 'Outbid', body: 'A higher bid arrived.' };

  it('never contacts an endpoint off the allowlist, and marks it for retirement', async () => {
    const error = await sendPush(
      { ...device, endpoint: 'https://169.254.169.254/latest/meta-data' },
      message,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PushEndpointRejectedError);
    // The device loop retires PushGoneError rows, so this one is retired too.
    expect(error).toBeInstanceOf(PushGoneError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds every request with a timeout and refuses redirects', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    await sendPush({ ...device, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }, message);
    expect(PUSH_TIMEOUT_MS).toBe(5_000);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });

  it('gives up on a push service that never answers', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const error = await sendPush(
      { ...device, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
      message,
      { timeoutMs: 50 },
    ).catch((caught: unknown) => caught);
    expect((error as Error).name).toBe('TimeoutError');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('still reports a gone subscription', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 410 }));
    await expect(
      sendPush({ ...device, endpoint: 'https://web.push.apple.com/QGx0' }, message),
    ).rejects.toBeInstanceOf(PushGoneError);
  });
});
