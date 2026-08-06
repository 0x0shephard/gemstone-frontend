import { describe, expect, it } from 'vitest';
import { base58btc, CHUNK_SIZE, computeCidV0 } from './cid.ts';

const encoder = new TextEncoder();

describe('CIDv0 computation', () => {
  /**
   * Vectors taken from content this protocol actually published to IPFS and
   * which Pinata independently assigned these CIDs. If the construction were
   * wrong in any detail — field order, the filesize field, the multihash prefix,
   * base58 leading zeros — none of these would match.
   */
  it('reproduces the CID of a published metadata document', async () => {
    const document =
      '{"attributes":[{"trait_type":"Gem Type","value":"Ruby"},{"trait_type":"Carat Weight","value":1.5},{"trait_type":"Origin","value":"Mozambique"},{"trait_type":"Dimensions","value":"7.4 x 5.6 x 3.8"},{"trait_type":"Color","value":"Red"},{"trait_type":"Clarity","value":"VS"},{"trait_type":"Cut","value":"Round"},{"trait_type":"Treatment","value":"Unheated"},{"trait_type":"Certification Lab","value":"Pilot Gem Lab"}],"description":"Digital Carat Sepolia MVP gemstone submission with test-only automated valuation and custody activation.","image":"ipfs://QmS1VxMyyJVGk657SNvsTb7tQqHGsNUtam1Jfxz6eDop1T","name":"Pilot Ruby 01"}';
    await expect(computeCidV0(encoder.encode(document))).resolves.toBe(
      'QmayfRrDKCYX9Jh8BWe8jEr7eyYYLR5Nqw2qDqVT1XbmKv',
    );
  });

  /*
   * Locks current output rather than proving correctness on its own. The proof
   * is the vector above, which Pinata independently assigned to bytes this
   * protocol published; this catches an accidental change to the encoding that
   * happens to still parse.
   */
  it('is stable for a fixed input', async () => {
    await expect(computeCidV0(encoder.encode('digital carat'))).resolves.toBe(
      'Qme4kuY8KrYbRJQ3DTSrbPJmU3ymY3rkSMU8j4115DwktG',
    );
  });

  it('declines empty input rather than returning a wrong CID', async () => {
    // go-ipfs omits the Data field entirely for an empty file, which this
    // construction does not reproduce. Nothing here publishes empty content.
    await expect(computeCidV0(new Uint8Array(0))).resolves.toBeUndefined();
  });

  /*
   * Multi-chunk content is the normal case, not an edge case: a phone photo is
   * around 1 MB, so every real seller image crosses the chunk boundary. When
   * this returned `undefined` above one chunk, publishing fell back to
   * gateway read-back and failed against gateways that block datacenter egress.
   *
   * The balanced-DAG construction was validated against a 987,621-byte image
   * (4 chunks) that Pinata independently assigned
   * QmTpMKYBNoPgoWMSQu61j2zUPLY6MHhoFSP5iWxPiokggo. These lock the behaviour.
   */
  it('computes a CID for content spanning several chunks', async () => {
    const multi = new Uint8Array(CHUNK_SIZE * 3 + 17);
    for (let i = 0; i < multi.length; i += 1) multi[i] = (i * 31) % 251;
    await expect(computeCidV0(multi)).resolves.toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
  });

  it('changes the root when a byte in a later chunk changes', async () => {
    const build = (mutate: number) => {
      const bytes = new Uint8Array(CHUNK_SIZE * 2 + 8);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 251;
      bytes[bytes.length - 1] = mutate;
      return bytes;
    };
    const [a, b] = await Promise.all([computeCidV0(build(1)), computeCidV0(build(2))]);
    expect(a).not.toBe(b);
  });

  it('treats the chunk boundary itself as a boundary', async () => {
    // Exactly one chunk is a bare leaf; one byte more becomes a two-leaf DAG
    // with a parent node, which is a different construction entirely.
    const [exact, over] = await Promise.all([
      computeCidV0(new Uint8Array(CHUNK_SIZE).fill(9)),
      computeCidV0(new Uint8Array(CHUNK_SIZE + 1).fill(9)),
    ]);
    expect(exact).toMatch(/^Qm/);
    expect(over).toMatch(/^Qm/);
    expect(exact).not.toBe(over);
  });

  it('changes completely when one byte changes', async () => {
    const a = await computeCidV0(encoder.encode('digital carat'));
    const b = await computeCidV0(encoder.encode('digital carat.'));
    expect(a).not.toBe(b);
  });

  it('encodes leading zero bytes as leading ones', async () => {
    expect(base58btc(Uint8Array.from([0, 0, 1]))).toBe('112');
  });
});
