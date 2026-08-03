/**
 * Local CIDv0 computation, for verifying a pinning provider's reported CID
 * without asking anyone else.
 *
 * Read-back through public gateways was the original integrity check, and it is
 * unreliable from a datacenter: those gateways refuse requests from cloud egress
 * ranges outright, so the check failed for reasons that had nothing to do with
 * the content. Computing the CID here is strictly stronger anyway — a CID *is*
 * the hash of the content, so a provider-reported CID that equals the one we
 * derive from our own bytes cannot describe anything else.
 *
 * Deliberately free of `npm:` specifiers, and uses Web Crypto so the same code
 * runs under Deno and under `vitest` on Node.
 */

/**
 * go-ipfs splits files into 262144-byte chunks and builds a multi-block DAG
 * above that, whose root CID this single-block construction would not reproduce.
 * Larger content therefore returns `undefined` rather than a confidently wrong
 * answer.
 */
export const SINGLE_BLOCK_LIMIT = 262_144;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58btc(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) out += BASE58[digits[index]];
  return out;
}

function varint(value: number): number[] {
  const out: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  out.push(remaining);
  return out;
}

function concat(parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part instanceof Uint8Array ? part : Uint8Array.from(part), offset);
    offset += part.length;
  }
  return out;
}

/** Protobuf field header plus payload. `wire` is 0 for varint, 2 for length-delimited. */
function field(number: number, wire: 0 | 2, payload: Uint8Array | number[]): Uint8Array {
  return concat([varint((number << 3) | wire), payload]);
}

function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  return concat([varint(bytes.length), bytes]);
}

/** UnixFS `Data` message for a whole file held in one block. */
function unixfsFile(bytes: Uint8Array): Uint8Array {
  return concat([
    field(1, 0, varint(2)), // Type = File
    field(2, 2, lengthPrefixed(bytes)), // Data
    field(3, 0, varint(bytes.length)), // filesize
  ]);
}

/** dag-pb `PBNode` carrying only `Data`; a single-block file has no links. */
function dagPbNode(data: Uint8Array): Uint8Array {
  return field(1, 2, lengthPrefixed(data));
}

/**
 * The CIDv0 a compliant IPFS implementation produces for these exact bytes.
 *
 * Returns `undefined` for content past {@link SINGLE_BLOCK_LIMIT}, where the
 * real CID is the root of a chunked DAG this does not construct.
 */
export async function computeCidV0(bytes: Uint8Array): Promise<string | undefined> {
  if (bytes.length > SINGLE_BLOCK_LIMIT) return undefined;
  /*
   * Empty input is not handled. go-ipfs omits the `Data` field entirely rather
   * than emitting a present-but-empty one, so this construction would produce a
   * different CID — and nothing here ever publishes empty content, so returning
   * `undefined` costs nothing and beats asserting a value that is wrong.
   */
  if (bytes.length === 0) return undefined;
  const block = dagPbNode(unixfsFile(bytes));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', block as BufferSource));
  // Multihash prefix: 0x12 = sha2-256, 0x20 = 32-byte digest.
  return base58btc(concat([[0x12, 0x20], digest]));
}
