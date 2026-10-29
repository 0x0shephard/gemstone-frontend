import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { utf8ToBase64 } from './base64.ts';

const decodeUtf8 = (encoded: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));

describe('UTF-8 base64', () => {
  it('encodes a title btoa rejects', () => {
    const title = 'Gift card — Ruby Horizon';
    expect(() => btoa(title)).toThrow();
    expect(decodeUtf8(utf8ToBase64(title))).toBe(title);
  });

  it('round-trips accents, curly quotes and emoji', () => {
    for (const title of ['Émeraude', '“For you”', 'Happy birthday 🎉', '']) {
      expect(decodeUtf8(utf8ToBase64(title))).toBe(title);
    }
  });

  it('matches btoa for plain ASCII', () => {
    expect(utf8ToBase64('Digital Carat gift')).toBe(btoa('Digital Carat gift'));
  });

  it('handles strings longer than one fromCharCode chunk', () => {
    const long = '—'.repeat(40_000);
    expect(decodeUtf8(utf8ToBase64(long))).toBe(long);
  });

  it('is what the Canva export sends', () => {
    const endpoint = readFileSync(
      join(process.cwd(), 'supabase/functions/v1-canva-export/index.ts'),
      'utf8',
    );
    expect(endpoint).toContain('name_base64: utf8ToBase64(title)');
    expect(endpoint).not.toContain('name_base64: btoa(');
  });
});
