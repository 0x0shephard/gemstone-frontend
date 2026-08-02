import { describe, expect, it, vi } from 'vitest';
import {
  assertNoPrivateFields,
  buildPublicMetadata,
  isValidCid,
  verifyPublishedDocument,
} from './metadataDocument.ts';

const attributes = {
  name: 'Ruby Horizon',
  gemstoneType: 'ruby',
  caratWeight: 1.25,
  origin: 'Mozambique',
  color: 'pigeon blood',
  clarity: 'VS',
  cut: 'oval',
  treatment: 'none',
  gradingLab: 'GIA',
  dimensions: '7.1 x 5.3 x 3.4 mm',
};

const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

function gatewayServing(bodyByGateway: Record<string, string | number>) {
  return vi.fn(async (url: string | URL) => {
    const href = String(url);
    const gateway = Object.keys(bodyByGateway).find((key) => href.startsWith(key));
    const body = gateway ? bodyByGateway[gateway] : 404;
    if (typeof body === 'number') {
      return { ok: false, status: body, statusText: 'Error' } as Response;
    }
    return { ok: true, status: 200, statusText: 'OK', text: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('public metadata document', () => {
  it('emits the ERC-721 shape with standard attributes', () => {
    const metadata = buildPublicMetadata(attributes);
    expect(metadata.name).toBe('Ruby Horizon');
    expect(metadata.attributes).toContainEqual({ trait_type: 'Carat Weight', value: 1.25 });
    expect(metadata.attributes).toContainEqual({ trait_type: 'Certification Lab', value: 'GIA' });
  });

  it('omits empty traits rather than publishing blanks', () => {
    const metadata = buildPublicMetadata({ name: 'Bare', gemstoneType: 'ruby', origin: '' });
    expect(metadata.attributes).toEqual([{ trait_type: 'Gem Type', value: 'ruby' }]);
  });

  it('includes an image only when one is supplied', () => {
    expect(buildPublicMetadata(attributes).image).toBeUndefined();
    expect(buildPublicMetadata(attributes, { image: 'ipfs://bafyimage' }).image).toBe(
      'ipfs://bafyimage',
    );
  });

  it('refuses to publish private fields', () => {
    expect(() =>
      assertNoPrivateFields({
        name: 'Leaky',
        description: 'x',
        attributes: [{ trait_type: 'Vault Location', value: 'Istanbul branch 4' }],
      }),
    ).toThrow(/must not contain private fields/i);
  });
});

describe('CID validation', () => {
  it('accepts v0 and v1 CIDs', () => {
    expect(isValidCid(CID)).toBe(true);
    expect(isValidCid('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'not-a-cid', 'Qmtooshort', 'https://ipfs.io/ipfs/Qm123']) {
      expect(isValidCid(value)).toBe(false);
    }
  });
});

describe('published document verification', () => {
  const gateways = ['https://a.example', 'https://b.example', 'https://c.example'];
  const document = '{"name":"Ruby Horizon"}';

  it('passes once two independent gateways return identical bytes', async () => {
    const result = await verifyPublishedDocument(
      CID,
      document,
      gateways,
      gatewayServing({
        'https://a.example': document,
        'https://b.example': document,
      }),
    );
    expect(result.confirmedBy).toEqual(['https://a.example', 'https://b.example']);
  });

  it('stops as soon as the confirmation threshold is met', async () => {
    const fetchImpl = gatewayServing({
      'https://a.example': document,
      'https://b.example': document,
      'https://c.example': document,
    });
    await verifyPublishedDocument(CID, document, gateways, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails when only one gateway can confirm', async () => {
    await expect(
      verifyPublishedDocument(
        CID,
        document,
        gateways,
        gatewayServing({ 'https://a.example': document }),
      ),
    ).rejects.toThrow(/confirmed by 1 of 2/i);
  });

  it('rejects a gateway serving different bytes', async () => {
    await expect(
      verifyPublishedDocument(
        CID,
        document,
        gateways,
        gatewayServing({
          'https://a.example': document,
          'https://b.example': '{"name":"Tampered"}',
          'https://c.example': '{"name":"Tampered"}',
        }),
      ),
    ).rejects.toThrow(/did not match/i);
  });

  it('refuses to verify a malformed CID at all', async () => {
    await expect(
      verifyPublishedDocument('not-a-cid', document, gateways, gatewayServing({})),
    ).rejects.toThrow(/malformed CID/i);
  });
});
