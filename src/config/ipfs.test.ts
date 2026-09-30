import { describe, expect, it } from 'vitest';
import { gatewayUrl, resizedIpfsImageUrl, resolveIpfsGateways } from './ipfs';

describe('IPFS gateway ordering', () => {
  it('tries the same-origin proxy before any public gateway', () => {
    expect(resolveIpfsGateways('https://ipfs.io/ipfs/')[0]).toBe('/ipfs');
    expect(resolveIpfsGateways('https://assets.example/ipfs/')[0]).toBe('/ipfs');
  });

  it('does not make mobile clients wait on the legacy ipfs.io handoff', () => {
    expect(resolveIpfsGateways('https://ipfs.io/ipfs/')[1]).toBe(
      'https://gateway.pinata.cloud/ipfs',
    );
  });

  it('keeps a custom operator gateway ahead of the public fallbacks', () => {
    expect(resolveIpfsGateways('https://assets.example/ipfs/')[1]).toBe(
      'https://assets.example/ipfs',
    );
  });

  it('resolves a CID against the same-origin path', () => {
    expect(gatewayUrl('/ipfs', 'ipfs://QmTest/meta.json')).toBe('/ipfs/QmTest/meta.json');
  });
});

describe('resized gem images', () => {
  it('points Netlify Image CDN at the Pinata original', () => {
    expect(resizedIpfsImageUrl('ipfs://QmPhoto')).toBe(
      `/.netlify/images?url=${encodeURIComponent('https://gateway.pinata.cloud/ipfs/QmPhoto')}&w=960`,
    );
  });

  it('leaves non-IPFS images alone', () => {
    expect(resizedIpfsImageUrl('data:image/svg+xml;base64,AA==')).toBeUndefined();
  });
});
