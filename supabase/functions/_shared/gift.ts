/*
 * Deliberately dependency-free. `auth.ts` reaches for the Supabase client at
 * import time, and none of the reasoning in this file — code shape, folding,
 * hashing — needs a database to be checked. Keeping it standalone is what makes
 * it testable outside Deno.
 */

/*
 * There is deliberately no expiry constant here. A card's claim window is the
 * stone's reserve escrow term, read per gem from the custody record — a voucher
 * over a tokenised gemstone cannot outlive the escrow backing it, and a
 * protocol-chosen duration would be exactly the kind of unilateral term a
 * voucher may not carry. A card that lapses forfeits nothing: the sender held
 * the token throughout.
 */

/**
 * Crockford's base32 alphabet: no I, L, O or U, so a code read off a printed
 * card cannot be mistyped as a different valid code. A recipient reads this
 * aloud or types it when the QR will not scan, which is exactly the situation
 * where 0/O and 1/I ambiguity costs someone their gemstone.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

/** 16 base32 characters ≈ 80 bits. Rejection sampling keeps it uniform. */
export function generateGiftCode(): string {
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (out.length === CODE_LENGTH) break;
      // 256 is not a multiple of 32 — it is 8×32 exactly, so a plain mask is
      // uniform here and no value has to be discarded.
      out.push(ALPHABET[byte & 31]);
    }
  }
  return out.join('');
}

/**
 * Accepts a code however it was written down: spaced, hyphenated, lower case.
 * Returns null when it is not a well-formed code, so a malformed input is
 * rejected before it reaches the database.
 */
export function normalizeGiftCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (cleaned.length !== CODE_LENGTH) return null;
  // Fold the characters Crockford treats as equivalent, so a hand-copied O, I
  // or L resolves to the 0 or 1 it was meant to be. U is excluded outright and
  // has no fold, so a code containing one is simply rejected below.
  const folded = cleaned.replace(/[OIL]/g, (character) => (character === 'O' ? '0' : '1'));
  return [...folded].every((character) => ALPHABET.includes(character)) ? folded : null;
}

/** Display form: four groups of four, the way it is printed on the card. */
export function formatGiftCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join('-');
}

/**
 * What actually goes in the database. The domain prefix means a hash from here
 * can never collide with one computed for any other purpose, and the version
 * segment leaves room to re-key without ambiguity if that is ever needed.
 */
export async function hashGiftCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`giftcard:v1:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Shows enough of an address to confirm it, without publishing the whole. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}${'•'.repeat(Math.max(1, local.length - head.length - tail.length))}${tail}@${domain}`;
}
