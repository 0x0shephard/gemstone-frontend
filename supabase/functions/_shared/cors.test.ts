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
      new Request('https://example.test/functions/v1-gift-create', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://digitalcarat.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,x-protocol-deployment',
        },
      }),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Access-Control-Allow-Headers')).toContain(
      'x-protocol-deployment',
    );
    expect(response?.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
