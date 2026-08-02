import { describe, expect, it, vi } from 'vitest';
import {
  assertNoPrivateFields,
  buildPublicMetadata,
  isValidCid,
  verifyPublishedBytes,
  verifyPublishedDocument,
} from './metadataDocument.ts';

const encoder = new TextEncoder();

/** Retries are real in production; tests must not spend 12s proving it. */
const NO_WAIT = { sleep: async () => {} };

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
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => encoder.encode(body).buffer,
    } as Response;
  }) as unknown as typeof fetch;
}

/** Serves raw bytes, for the image path where there is no text form. */
function gatewayServingBytes(bodyByGateway: Record<string, Uint8Array | number>) {
  return vi.fn(async (url: string | URL) => {
    const href = String(url);
    const gateway = Object.keys(bodyByGateway).find((key) => href.startsWith(key));
    const body = gateway ? bodyByGateway[gateway] : 404;
    if (typeof body === 'number') {
      return { ok: false, status: body, statusText: 'Error' } as Response;
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => body.buffer,
    } as Response;
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
      NO_WAIT,
    );
    expect(result.confirmedBy).toEqual(['https://a.example', 'https://b.example']);
  });

  it('stops as soon as the confirmation threshold is met', async () => {
    const fetchImpl = gatewayServing({
      'https://a.example': document,
      'https://b.example': document,
      'https://c.example': document,
    });
    await verifyPublishedDocument(CID, document, gateways, fetchImpl, NO_WAIT);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails when only one gateway can confirm', async () => {
    await expect(
      verifyPublishedDocument(
        CID,
        document,
        gateways,
        gatewayServing({ 'https://a.example': document }),
        NO_WAIT,
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
        NO_WAIT,
      ),
    ).rejects.toThrow(/different bytes/i);
  });

  it('refuses to verify a malformed CID at all', async () => {
    await expect(
      verifyPublishedDocument('not-a-cid', document, gateways, gatewayServing({}), NO_WAIT),
    ).rejects.toThrow(/malformed CID/i);
  });
});

describe('published image verification', () => {
  const gateways = ['https://a.example', 'https://b.example', 'https://c.example'];
  // A PNG header plus a byte no text decoder round-trips cleanly, so a
  // text-based comparison would pass here where a byte comparison must not.
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);

  it('passes once two gateways return byte-identical image data', async () => {
    const result = await verifyPublishedBytes(
      CID,
      image,
      gateways,
      gatewayServingBytes({ 'https://a.example': image, 'https://b.example': image }),
      { label: 'Image', ...NO_WAIT },
    );
    expect(result.confirmedBy).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects a gateway whose bytes differ only past the text-decodable prefix', async () => {
    const tampered = new Uint8Array(image);
    tampered[tampered.length - 1] = 0x00;
    await expect(
      verifyPublishedBytes(
        CID,
        image,
        gateways,
        gatewayServingBytes({
          'https://a.example': image,
          'https://b.example': tampered,
          'https://c.example': tampered,
        }),
        { label: 'Image', ...NO_WAIT },
      ),
    ).rejects.toThrow(/different bytes/i);
  });

  it('rejects a truncated response of the same prefix', async () => {
    await expect(
      verifyPublishedBytes(
        CID,
        image,
        gateways,
        gatewayServingBytes({
          'https://a.example': image,
          'https://b.example': image.slice(0, 8),
          'https://c.example': image.slice(0, 8),
        }),
        { label: 'Image', ...NO_WAIT },
      ),
    ).rejects.toThrow(/different bytes/i);
  });

  it('names the failing subject in the error, so an image failure is not read as metadata', async () => {
    await expect(
      verifyPublishedBytes(CID, image, gateways, gatewayServingBytes({}), {
        label: 'Image',
        ...NO_WAIT,
      }),
    ).rejects.toThrow(/^Image CID/);
  });
});

describe('read-back retries', () => {
  const gateways = ['https://a.example', 'https://b.example'];
  const document = '{"name":"Ruby Horizon"}';

  /** Fails the first `failFor` calls per gateway, then serves correctly. */
  function flakyGateway(failFor: number) {
    const seen = new Map<string, number>();
    return vi.fn(async (url: string | URL) => {
      const gateway = gateways.find((candidate) => String(url).startsWith(candidate));
      const count = (seen.get(gateway ?? '') ?? 0) + 1;
      seen.set(gateway ?? '', count);
      if (count <= failFor) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => encoder.encode(document).buffer,
      } as Response;
    }) as unknown as typeof fetch;
  }

  it('recovers when a gateway rate-limits the first pass', async () => {
    // Exactly the production failure: freshly pinned content, gateways throttling
    // datacenter egress. One pass would have made this a permanent failure.
    const result = await verifyPublishedDocument(CID, document, gateways, flakyGateway(1), {
      ...NO_WAIT,
    });
    expect(result.confirmedBy).toHaveLength(2);
  });

  it('gives up after the configured number of attempts', async () => {
    await expect(
      verifyPublishedDocument(CID, document, gateways, flakyGateway(99), {
        attempts: 2,
        ...NO_WAIT,
      }),
    ).rejects.toThrow(/after 2 attempts/i);
  });

  it('does not retry a byte mismatch, which waiting cannot fix', async () => {
    const fetchImpl = gatewayServing({
      'https://a.example': document,
      'https://b.example': '{"name":"Tampered"}',
    });
    await expect(
      verifyPublishedDocument(CID, document, gateways, fetchImpl, NO_WAIT),
    ).rejects.toThrow(/different bytes/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
