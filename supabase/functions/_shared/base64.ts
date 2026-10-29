/**
 * Base64 of a string's UTF-8 bytes.
 *
 * `btoa` accepts only Latin-1: it throws on any code point above U+00FF, so a
 * title containing an em dash, a curly quote or an emoji failed outright. The
 * string is encoded to UTF-8 first and those bytes are what get base64-encoded,
 * which is also what Canva's `name_base64` expects.
 */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked so a long string does not exceed the argument limit of fromCharCode.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
