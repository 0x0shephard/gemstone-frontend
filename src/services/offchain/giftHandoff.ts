import type { CreatedGiftCard } from './gift';

/**
 * Holds an issued gift card across a full-page redirect.
 *
 * Connecting Canva is an OAuth redirect: the whole document is replaced, and
 * everything the issuing screen held goes with it. That included the card's
 * one-time code, which the server stores only as a hash — so it exists in
 * exactly one place, the screen that was just destroyed, and could not be
 * recovered by anyone afterwards. The card stayed valid and unclaimable.
 *
 * `sessionStorage` rather than `localStorage`: this is a secret, and its useful
 * life is the few seconds between leaving for Canva and coming back. Session
 * storage is scoped to the tab and dies with it, and the entry is removed the
 * moment it is read.
 */

const KEY = 'dc:gift-handoff';

interface GiftHandoff {
  gemId: string;
  card: CreatedGiftCard;
  recipientName: string;
  message: string;
  template: string;
  savedAt: number;
}

/** Long enough for an OAuth round trip, short enough not to linger. */
const MAX_AGE_MS = 15 * 60 * 1_000;

export function saveGiftHandoff(handoff: Omit<GiftHandoff, 'savedAt'>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...handoff, savedAt: Date.now() }));
  } catch {
    // Private mode or a full quota. The redirect is about to happen either way;
    // throwing here would replace a recoverable problem with a broken button.
  }
}

/**
 * Returns the stored card once, then forgets it.
 *
 * Read-and-clear rather than read-then-clear-later: a code that survives being
 * restored is a code sitting in storage for no further purpose.
 */
export function takeGiftHandoff(gemId: string): GiftHandoff | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as GiftHandoff;
    if (parsed.gemId !== gemId) return undefined;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function clearGiftHandoff(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do; an unreadable store is also an unwritable one.
  }
}
