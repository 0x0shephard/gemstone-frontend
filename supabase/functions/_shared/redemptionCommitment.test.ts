import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizedFulfillmentDetails, sameFulfillmentDetails } from './redemptionCommitment';

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

  it('normalizes and allowlists the exact fulfillment fields', () => {
    expect(
      normalizedFulfillmentDetails('insured_delivery', {
        recipientName: '  Ada   Lovelace ',
        addressLine1: ' 1 Main ',
        addressLine2: '',
        city: ' London ',
        region: '',
        postalCode: ' W1 ',
        country: ' UK ',
        ignored: 'not committed',
      }),
    ).toEqual({
      recipientName: 'Ada Lovelace',
      addressLine1: '1 Main',
      city: 'London',
      postalCode: 'W1',
      country: 'UK',
    });
    expect(() => normalizedFulfillmentDetails('pickup', {})).toThrow('pickupLocation');
  });

  it('changes the onchain request hash when the committed destination changes', () => {
    const base = {
      requesterWallet: '0x0000000000000000000000000000000000000001',
      gemId: '1',
      tokenId: '2',
      fulfillmentMethod: 'insured_delivery',
      workflowRecordId: '00000000-0000-4000-8000-000000000001',
      timestamp: '2026-10-04T00:00:00.000Z',
    };
    const first = {
      ...base,
      fulfillmentDetails: normalizedFulfillmentDetails('insured_delivery', {
        recipientName: 'Ada',
        addressLine1: '1 Main',
        city: 'London',
        postalCode: 'W1',
        country: 'UK',
      }),
    };
    const changed = {
      ...base,
      fulfillmentDetails: normalizedFulfillmentDetails('insured_delivery', {
        recipientName: 'Ada',
        addressLine1: '2 Main',
        city: 'London',
        postalCode: 'W1',
        country: 'UK',
      }),
    };
    const digest = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(digest(changed)).not.toBe(digest(first));
    expect(endpoint).toContain('fulfillmentDetails: normalizedDetails');
  });

  it('compares JSONB fulfillment details semantically rather than by key order', () => {
    expect(
      sameFulfillmentDetails(
        { country: 'UK', city: 'London', recipientName: 'Ada' },
        { recipientName: 'Ada', city: 'London', country: 'UK' },
      ),
    ).toBe(true);
    expect(
      sameFulfillmentDetails(
        { country: 'UK', city: 'London', recipientName: 'Ada' },
        { recipientName: 'Grace', city: 'London', country: 'UK' },
      ),
    ).toBe(false);
  });
});
