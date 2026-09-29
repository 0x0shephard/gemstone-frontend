import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGS_RPC_URL, resolveLogsRpcUrl } from './rpcSelection';

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
    expect(resolveLogsRpcUrl('https://arbitrum.example', undefined, 42161)).toBe(
      'https://arbitrum.example',
    );
  });

  it('keeps a local node for historical reads instead of public Sepolia', () => {
    expect(
      resolveLogsRpcUrl('http://host.docker.internal:8545', 'http://host.docker.internal:8545'),
    ).toBe('http://host.docker.internal:8545');
    expect(resolveLogsRpcUrl('http://127.0.0.1:8545')).toBe('http://127.0.0.1:8545');
  });
});
