import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import { keccak256, toBytes, type Address, type Hash } from 'npm:viem@2';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

/** A reproducible 128-bit code; plaintext never needs database storage. */
export async function deriveOwnerCode(secret: string, generationId: string): Promise<string> {
  if (secret.length < 32) throw new Error('REDEMPTION_CODE_SECRET must be at least 32 characters');
  return bytesToHex((await hmac(secret, `owner-code:${generationId}`)).slice(0, 16)).toUpperCase();
}

export async function ownerCodeHash(
  secret: string,
  requestId: string,
  code: string,
): Promise<string> {
  return bytesToHex(
    await hmac(secret, `owner-code-hash:${requestId}:${code.trim().toUpperCase()}`),
  );
}

export function ownerAuthorizationChallenge(input: {
  deploymentId: string;
  requestId: string;
  requestHash: Hash;
  tokenId: string;
  ownerWallet: Address;
  challengeId: string;
  expiresAt: string;
}): string {
  const canonical = canonicalize({
    schema: 'digital-carat-owner-authorization/v1',
    deploymentId: input.deploymentId,
    requestId: input.requestId,
    requestHash: input.requestHash.toLowerCase(),
    tokenId: input.tokenId,
    ownerWallet: input.ownerWallet.toLowerCase(),
    challengeId: input.challengeId,
    expiresAt: input.expiresAt,
  });
  return `Digital Carat redemption owner authorization\n${keccak256(toBytes(canonical))}`;
}
