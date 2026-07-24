import { canonicalize } from 'npm:json-canonicalize@1.1.0';
import { keccak256, toBytes, type Hash } from 'npm:viem@2';
import { randomHex } from './auth.ts';

export function createCommitment(payload: Record<string, unknown>): {
  canonicalPayload: string;
  hash: Hash;
  nonce: `0x${string}`;
} {
  const nonce = randomHex(32);
  const canonicalPayload = canonicalize({ ...payload, nonce });
  return { canonicalPayload, hash: keccak256(toBytes(canonicalPayload)), nonce };
}
