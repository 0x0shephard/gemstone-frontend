import { describe, expect, it } from 'vitest';
import { base58btc, computeCidV0, SINGLE_BLOCK_LIMIT } from './cid.ts';

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

  it('refuses content past the single-block limit rather than guessing', async () => {
    // Above this go-ipfs builds a chunked DAG whose root differs. A confidently
    // wrong CID here would be worse than no answer: it would fail a comparison
    // the provider actually got right.
    await expect(computeCidV0(new Uint8Array(SINGLE_BLOCK_LIMIT + 1))).resolves.toBeUndefined();
  });

  it('still computes at exactly the limit', async () => {
    await expect(computeCidV0(new Uint8Array(SINGLE_BLOCK_LIMIT))).resolves.toMatch(/^Qm/);
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
