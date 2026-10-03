import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corsHeaders, preflight } from './cors.ts';

describe('Edge Function CORS', () => {
  it('allows the immutable protocol deployment header', () => {
    expect(corsHeaders['Access-Control-Allow-Headers'].split(/,\s*/)).toContain(
      'x-protocol-deployment',
    );
  });

  it('answers a browser preflight for the protocol deployment header', () => {
    const response = preflight(
      new Request('https://example.test/functions/v1/v1-redemption-commitment', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://digitalcarat.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,x-protocol-deployment',
        },
      }),
    );
    expect(response?.status).toBe(200);
    const allowedHeaders = response?.headers.get('Access-Control-Allow-Headers') ?? '';
    for (const header of [
      'authorization',
      'x-client-info',
      'apikey',
      'content-type',
      'x-protocol-deployment',
    ]) {
      expect(allowedHeaders.split(/,\s*/)).toContain(header);
    }
    expect(response?.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('handles redemption preflight before auth or fulfillment body parsing', () => {
    const endpoint = readFileSync(
      join(process.cwd(), 'supabase/functions/v1-redemption-commitment/index.ts'),
      'utf8',
    );
    const preflightCheck = endpoint.indexOf('const early = preflight(request)');
    const earlyReturn = endpoint.indexOf('if (early) return early');
    const auth = endpoint.indexOf('await requireUser(request)');
    const body = endpoint.indexOf('await request.json()');

    expect(preflightCheck).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(preflightCheck);
    expect(auth).toBeGreaterThan(earlyReturn);
    expect(body).toBeGreaterThan(earlyReturn);
  });
});
