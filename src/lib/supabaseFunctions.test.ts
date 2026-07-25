import { describe, expect, it } from 'vitest';
import { functionErrorMessage } from './supabaseFunctions';

describe('functionErrorMessage', () => {
  it('uses the structured function response', async () => {
    const error = {
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ error: 'Domain or URI mismatch' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
    await expect(functionErrorMessage(error, null, 'Fallback')).resolves.toBe(
      'Domain or URI mismatch',
    );
  });

  it('prefers returned data and otherwise uses the fallback', async () => {
    await expect(
      functionErrorMessage(new Error('Generic'), { error: 'Nonce expired' }, 'Fallback'),
    ).resolves.toBe('Nonce expired');
    await expect(functionErrorMessage(null, null, 'Fallback')).resolves.toBe('Fallback');
  });
});
