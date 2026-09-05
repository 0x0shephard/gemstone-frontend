import { describe, expect, it } from 'vitest';
import { resolveIpfsGateways } from './ipfs';

describe('IPFS gateway ordering', () => {
  it('does not make mobile clients wait on the legacy ipfs.io handoff', () => {
    expect(resolveIpfsGateways('https://ipfs.io/ipfs/')[0]).toBe(
      'https://gateway.pinata.cloud/ipfs',
    );
  });

  it('keeps a custom operator gateway first', () => {
    expect(resolveIpfsGateways('https://assets.example/ipfs/')[0]).toBe(
      'https://assets.example/ipfs',
    );
  });
});
