import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGS_RPC_URL, DEFAULT_LOGS_RPC_URLS, resolveLogsRpcUrl } from './rpcSelection';

describe('historical logs RPC selection', () => {
  it('uses the wide-range default when no dedicated endpoint is configured', () => {
    expect(resolveLogsRpcUrl('https://operator.example')).toBe(DEFAULT_LOGS_RPC_URL);
  });

  it('rejects an operator endpoint mistakenly repeated as the logs endpoint', () => {
    expect(resolveLogsRpcUrl('https://operator.example/', '  https://operator.example  ')).toBe(
      DEFAULT_LOGS_RPC_URL,
    );
  });

  it('preserves a genuinely separate logs endpoint', () => {
    expect(resolveLogsRpcUrl('https://operator.example', 'https://logs.example')).toBe(
      'https://logs.example',
    );
  });

  it('never sends a production L2 history query to the Sepolia fallback', () => {
    expect(resolveLogsRpcUrl('https://arbitrum.example', undefined, 42161)).not.toBe(
      DEFAULT_LOGS_RPC_URL,
    );
  });

  it('keeps an unconfigured Arbitrum One scan off the operator RPC', () => {
    // Uncapped history scans on the operator key spent its request budget.
    expect(resolveLogsRpcUrl('https://arb-mainnet.example/v2/key', undefined, 42161)).toBe(
      DEFAULT_LOGS_RPC_URLS[42161],
    );
    expect(
      resolveLogsRpcUrl(
        'https://arb-mainnet.example/v2/key',
        'https://arb-mainnet.example/v2/key',
        42161,
      ),
    ).toBe(DEFAULT_LOGS_RPC_URLS[42161]);
  });

  it('still prefers a configured logs endpoint on Arbitrum One', () => {
    expect(resolveLogsRpcUrl('https://operator.example', 'https://logs.example', 42161)).toBe(
      'https://logs.example',
    );
  });

  it('falls back to the operator RPC only for a chain with no known public endpoint', () => {
    expect(resolveLogsRpcUrl('https://base.example', undefined, 8453)).toBe('https://base.example');
  });

  it('keeps a local node for historical reads instead of public Sepolia', () => {
    expect(
      resolveLogsRpcUrl('http://host.docker.internal:8545', 'http://host.docker.internal:8545'),
    ).toBe('http://host.docker.internal:8545');
    expect(resolveLogsRpcUrl('http://127.0.0.1:8545')).toBe('http://127.0.0.1:8545');
  });

  it('falls back on Arbitrum One to an endpoint that serves history from the deployment block', () => {
    // PublicNode's free tier refuses archive ranges; arb1 serves them.
    expect(DEFAULT_LOGS_RPC_URLS[42161]).toBe('https://arb1.arbitrum.io/rpc');
  });
});
