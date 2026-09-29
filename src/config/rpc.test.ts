import { describe, expect, it } from 'vitest';
import { isLocalRpc, resolveRpcUrls, SEPOLIA_PUBLIC_RPC } from './rpc';

describe('RPC endpoint resolution', () => {
  it('keeps the configured RPC first and adds a public Sepolia fallback', () => {
    expect(resolveRpcUrls(11155111, 'https://primary.example', '')).toEqual([
      'https://primary.example',
      SEPOLIA_PUBLIC_RPC,
    ]);
  });

  it('prefers an explicit fallback and removes duplicates', () => {
    expect(resolveRpcUrls(11155111, 'https://primary.example', 'https://fallback.example')).toEqual(
      ['https://primary.example', 'https://fallback.example', SEPOLIA_PUBLIC_RPC],
    );
    expect(resolveRpcUrls(11155111, SEPOLIA_PUBLIC_RPC, SEPOLIA_PUBLIC_RPC)).toEqual([
      SEPOLIA_PUBLIC_RPC,
    ]);
  });

  it('does not attach a Sepolia endpoint to another chain', () => {
    expect(resolveRpcUrls(31337, 'http://127.0.0.1:8545', '')).toEqual(['http://127.0.0.1:8545']);
  });
});

describe('local chains', () => {
  it('never falls back to public Sepolia from a loopback RPC', () => {
    expect(resolveRpcUrls(11155111, 'http://127.0.0.1:8545', 'https://fallback.example')).toEqual([
      'http://127.0.0.1:8545',
    ]);
    expect(isLocalRpc('http://localhost:8545')).toBe(true);
    expect(isLocalRpc('https://eth-sepolia.g.alchemy.com/v2/key')).toBe(false);
  });
});
