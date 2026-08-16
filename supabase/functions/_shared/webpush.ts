/**
 * Web Push, implemented against the specs rather than through a library.
 *
 * Two RFCs, both small:
 *   RFC 8291  the payload is encrypted end to end, so the push service relays
 *             something it cannot read.
 *   RFC 8292  the request is signed with an application key, so the push
 *             service can attribute and rate-limit a sender.
 *
 * Done here with WebCrypto because the usual npm client leans on Node's crypto
 * and http modules, and this runs on Deno Deploy where that compatibility is the
 * thing most likely to break — at the cost of a five-minute deploy per attempt.
 * The primitives needed are HMAC, ECDH and AES-GCM, all of which WebCrypto has.
 */

const encoder = new TextEncoder();

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data as BufferSource));
}

/** One-block HKDF, which is all the Web Push key schedule ever needs. */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, Uint8Array.of(1)));
  return okm.slice(0, length);
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushGoneError extends Error {
  constructor(readonly status: number) {
    super(`Push subscription is no longer valid (${status})`);
    this.name = 'PushGoneError';
  }
}

export function pushConfigured(): boolean {
  return Boolean(
    Deno.env.get('VAPID_PUBLIC_KEY')?.trim() && Deno.env.get('VAPID_PRIVATE_KEY')?.trim(),
  );
}

/**
 * The VAPID signing key, rebuilt from the stored scalar and public point.
 *
 * WebCrypto will only import a private EC key as a complete JWK, and the stored
 * secret is just the scalar. The public point supplies the rest: an
 * uncompressed P-256 point is `0x04 || x || y`, 32 bytes each.
 */
async function vapidKey(): Promise<CryptoKey> {
  const publicBytes = b64urlToBytes(Deno.env.get('VAPID_PUBLIC_KEY')!.trim());
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 point');
  }
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: Deno.env.get('VAPID_PRIVATE_KEY')!.trim(),
      x: bytesToB64url(publicBytes.slice(1, 33)),
      y: bytesToB64url(publicBytes.slice(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** RFC 8292 Authorization header, scoped to one push service origin. */
async function vapidHeader(endpoint: string, subject: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        // Twelve hours. The spec caps this at 24; shorter limits how long a
        // captured token stays useful without needing refresh machinery.
        exp: Math.floor(Date.now() / 1_000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapidKey(),
    encoder.encode(signingInput),
  );
  // WebCrypto already returns the raw r||s form ES256 wants, unlike the DER
  // encoding a general-purpose signer would produce.
  const token = `${signingInput}.${bytesToB64url(new Uint8Array(signature))}`;
  return `vapid t=${token}, k=${Deno.env.get('VAPID_PUBLIC_KEY')!.trim()}`;
}

/** RFC 8291 `aes128gcm` body, encrypted to the device's key. */
async function encryptPayload(
  subscription: PushSubscription,
  plaintext: string,
): Promise<Uint8Array> {
  const clientPublic = b64urlToBytes(subscription.p256dh);
  const authSecret = b64urlToBytes(subscription.auth);

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const ephemeralPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey),
  );

  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: await crypto.subtle.importKey(
          'raw',
          clientPublic as BufferSource,
          { name: 'ECDH', namedCurve: 'P-256' },
          false,
          [],
        ),
      },
      ephemeral.privateKey,
      256,
    ),
  );

  // The order of the two public keys in `key_info` is fixed by the spec:
  // recipient first, sender second. Swapping them yields a key the device
  // derives differently, and the only symptom is silence.
  const keyInfo = concat(
    encoder.encode('WebPush: info\0'),
    clientPublic,
    ephemeralPublic,
  );
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const body = encoder.encode(plaintext);
  // 0x02 is the final-record delimiter. Without it the device rejects the
  // record as truncated.
  const padded = concat(body, Uint8Array.of(2));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']),
      padded as BufferSource,
    ),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4_096);

  return concat(
    salt,
    recordSize,
    Uint8Array.of(ephemeralPublic.length),
    ephemeralPublic,
    ciphertext,
  );
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where clicking it should land, relative to the site origin. */
  url?: string;
  /** Collapses earlier notifications with the same tag on the device. */
  tag?: string;
}

/**
 * Delivers one message to one device.
 *
 * Throws {@link PushGoneError} when the push service says the subscription is
 * dead, which is a normal end-of-life for a device rather than a fault: the
 * caller should retire the row and carry on with the other devices.
 */
export async function sendPush(
  subscription: PushSubscription,
  message: PushMessage,
  options: { subject?: string; ttlSeconds?: number } = {},
): Promise<void> {
  if (!pushConfigured()) throw new Error('Web Push is not configured');

  const payload = await encryptPayload(subscription, JSON.stringify(message));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(
        subscription.endpoint,
        options.subject ?? Deno.env.get('VAPID_SUBJECT')?.trim() ?? 'mailto:support@digitalcarat.io',
      ),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Held for a day if the device is offline. These messages are about
      // deadlines, so one that arrives a week late is worse than none.
      TTL: String(options.ttlSeconds ?? 86_400),
      Urgency: 'normal',
    },
    body: payload as BodyInit,
  });

  if (response.status === 404 || response.status === 410) {
    throw new PushGoneError(response.status);
  }
  if (!response.ok) {
    throw new Error(`Push service returned ${response.status}: ${await response.text()}`);
  }
}
