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
 * Reproduces kubo's defaults, which is what the pinning provider runs:
 * 262144-byte fixed chunking, a balanced DAG with at most 174 links per node,
 * UnixFS file leaves (not raw leaves), dag-pb blocks and sha2-256.
 *
 * Deliberately free of `npm:` specifiers, and uses Web Crypto so the same code
 * runs under Deno and under `vitest` on Node.
 */

/** kubo's default fixed-size chunker. */
export const CHUNK_SIZE = 262_144;

/** kubo's default balanced-layout fan-out. */
export const MAX_LINKS_PER_NODE = 174;

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

/** Protobuf field header. `wire` is 0 for varint, 2 for length-delimited. */
const key = (field: number, wire: 0 | 2): number[] => varint((field << 3) | wire);
const lengthPrefixed = (bytes: Uint8Array): Uint8Array => concat([varint(bytes.length), bytes]);

/**
 * UnixFS `Data` message.
 *
 * A leaf carries `Data`; an interior node carries `blocksizes`, one per child,
 * and omits `Data` entirely.
 */
function unixfsFile(options: {
  data?: Uint8Array;
  filesize: number;
  blocksizes?: number[];
}): Uint8Array {
  const parts: Array<Uint8Array | number[]> = [key(1, 0), varint(2)]; // Type = File
  if (options.data && options.data.length > 0) {
    parts.push(key(2, 2), lengthPrefixed(options.data));
  }
  parts.push(key(3, 0), varint(options.filesize));
  for (const size of options.blocksizes ?? []) parts.push(key(4, 0), varint(size));
  return concat(parts);
}

/** dag-pb `PBLink`: Hash, Name, Tsize — in that field order. */
function pbLink(hash: Uint8Array, tsize: number): Uint8Array {
  return concat([
    key(1, 2),
    lengthPrefixed(hash),
    key(2, 2),
    varint(0), // Name: present but empty, as kubo emits for file chunks
    key(3, 0),
    varint(tsize),
  ]);
}

/**
 * dag-pb `PBNode`.
 *
 * Canonical encoding writes `Links` (field 2) *before* `Data` (field 1), which
 * is the opposite of field order. Getting this backwards yields a plausible but
 * wrong CID.
 */
function pbNode(links: Uint8Array[], data: Uint8Array): Uint8Array {
  const parts: Array<Uint8Array | number[]> = [];
  for (const link of links) parts.push(key(2, 2), lengthPrefixed(link));
  if (data.length > 0) parts.push(key(1, 2), lengthPrefixed(data));
  return concat(parts);
}

async function multihash(block: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', block as BufferSource));
  // 0x12 = sha2-256, 0x20 = 32-byte digest.
  return concat([[0x12, 0x20], digest]);
}

interface Node {
  hash: Uint8Array;
  /** Serialised size of this block plus every block beneath it. */
  tsize: number;
  /** Bytes of file content beneath this node. */
  filesize: number;
}

/**
 * The CIDv0 a compliant IPFS implementation produces for these exact bytes.
 *
 * Returns `undefined` only for empty input: kubo omits the `Data` field for an
 * empty file rather than emitting a present-but-empty one, and nothing here
 * publishes empty content, so declining beats asserting a value that is wrong.
 */
export async function computeCidV0(bytes: Uint8Array): Promise<string | undefined> {
  if (bytes.length === 0) return undefined;

  let layer: Node[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const piece = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
    const block = pbNode([], unixfsFile({ data: piece, filesize: piece.length }));
    layer.push({ hash: await multihash(block), tsize: block.length, filesize: piece.length });
  }

  // Balanced layout: fold each generation into parents until one root remains.
  while (layer.length > 1) {
    const parents: Node[] = [];
    for (let index = 0; index < layer.length; index += MAX_LINKS_PER_NODE) {
      const children = layer.slice(index, index + MAX_LINKS_PER_NODE);
      const filesize = children.reduce((sum, child) => sum + child.filesize, 0);
      const block = pbNode(
        children.map((child) => pbLink(child.hash, child.tsize)),
        unixfsFile({ filesize, blocksizes: children.map((child) => child.filesize) }),
      );
      parents.push({
        hash: await multihash(block),
        tsize: block.length + children.reduce((sum, child) => sum + child.tsize, 0),
        filesize,
      });
    }
    layer = parents;
  }

  return base58btc(layer[0].hash);
}
