import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const endpoint = readFileSync(
  join(process.cwd(), 'supabase/functions/v1-redemption-commitment/index.ts'),
  'utf8',
);

describe('redemption commitment persistence', () => {
  it('does not return a chain request hash unless the committed row was persisted', () => {
    const update = endpoint.indexOf('const { data: committed, error: commitmentError }');
    const checkError = endpoint.indexOf('if (commitmentError) throw commitmentError');
    const checkRow = endpoint.indexOf('if (!committed)');
    const response = endpoint.indexOf('requestHash: commitment.hash');

    expect(update).toBeGreaterThan(-1);
    expect(checkError).toBeGreaterThan(update);
    expect(checkRow).toBeGreaterThan(checkError);
    expect(response).toBeGreaterThan(checkRow);
    expect(endpoint.slice(update, checkError)).toContain(".eq('status', 'draft')");
    expect(endpoint.slice(update, checkError)).toContain(".select('id')");
  });

  it('documents and validates the exact fulfillment branch requirements', () => {
    expect(endpoint).toContain("fulfillmentMethod === 'pickup'");
    expect(endpoint).toContain('fulfillmentDetails?.pickupLocation');
    for (const field of ['recipientName', 'addressLine1', 'city', 'country', 'postalCode']) {
      expect(endpoint).toContain(`fulfillmentDetails?.${field}`);
    }
  });
});
