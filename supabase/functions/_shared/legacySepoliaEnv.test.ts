import { describe, expect, it } from 'vitest';
import { assertNoLegacySepoliaFallback, deploymentRpcUrl } from './legacySepoliaEnv';

const env =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

const arbitrumLegacyOnly = env({
  CHAIN_ID: '42161',
  SEPOLIA_RPC_URL: 'https://sepolia.example',
  SEPOLIA_OPERATOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
});

describe('legacy Sepolia secret fallbacks', () => {
  it('refuses the Sepolia operator key on Arbitrum when OPERATOR_PRIVATE_KEY is missing', () => {
    expect(() =>
      assertNoLegacySepoliaFallback(
        env({
          CHAIN_ID: '42161',
          RPC_URL: 'https://arb.example',
          SEPOLIA_OPERATOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        }),
      ),
    ).toThrow('SEPOLIA_OPERATOR_PRIVATE_KEY fallback is only allowed on Sepolia');
  });

  it('refuses the Sepolia RPC on Arbitrum', () => {
    expect(() => assertNoLegacySepoliaFallback(arbitrumLegacyOnly)).toThrow(
      'RPC_URL is not configured for chain 42161',
    );
    expect(() => deploymentRpcUrl(arbitrumLegacyOnly)).toThrow(
      'SEPOLIA_RPC_URL fallback is only allowed on Sepolia',
    );
  });

  it('accepts the network-neutral secrets on Arbitrum', () => {
    const configured = env({
      CHAIN_ID: '42161',
      RPC_URL: 'https://arb.example',
      OPERATOR_PRIVATE_KEY: `0x${'2'.repeat(64)}`,
      SEPOLIA_RPC_URL: 'https://sepolia.example',
      SEPOLIA_OPERATOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    });
    expect(() => assertNoLegacySepoliaFallback(configured)).not.toThrow();
    expect(deploymentRpcUrl(configured)).toBe('https://arb.example');
  });

  it('keeps the legacy fallbacks on Sepolia', () => {
    const sepolia = env({
      CHAIN_ID: '11155111',
      SEPOLIA_RPC_URL: 'https://sepolia.example',
      SEPOLIA_OPERATOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
    });
    expect(() => assertNoLegacySepoliaFallback(sepolia)).not.toThrow();
    expect(deploymentRpcUrl(sepolia)).toBe('https://sepolia.example');
  });

  it('fails closed with no RPC at all', () => {
    expect(() => deploymentRpcUrl(env({ CHAIN_ID: '11155111' }))).toThrow(
      'RPC_URL is not configured',
    );
  });
});
