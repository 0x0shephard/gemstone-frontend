import { describe, expect, it } from 'vitest';
import { safeErrorMessage } from './errors.ts';

describe('seller automation error sanitization', () => {
  it('uses concise contract errors and removes RPC URLs', () => {
    expect(
      safeErrorMessage(
        {
          shortMessage:
            'Contract function reverted while calling https://eth-sepolia.g.alchemy.com/v2/private-key',
        },
        'Activation failed',
      ),
    ).toBe('Contract function reverted while calling [RPC endpoint]');
  });

  it('returns only the first line of generic errors', () => {
    expect(safeErrorMessage(new Error('Primary failure\nRequest body: secret'), 'Fallback')).toBe(
      'Primary failure',
    );
  });

  it('retains sanitized RPC details for diagnosis', () => {
    expect(
      safeErrorMessage(
        {
          shortMessage: 'JSON is not a valid request object.',
          details: 'invalid transaction at https://rpc.example/private',
        },
        'Fallback',
      ),
    ).toBe('JSON is not a valid request object. — invalid transaction at [RPC endpoint]');
  });
});
