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
});
