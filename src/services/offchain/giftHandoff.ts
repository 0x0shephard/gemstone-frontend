import type { Hash } from 'viem';
import type { CreatedGiftCard, GiftPreparationKey } from './gift';

/**
 * A tab-scoped recovery record for a gift whose one-time code cannot be read
 * back from the server. Records are isolated by chain, sender account and card
 * so opening a second composer cannot consume or overwrite the first one.
 */
export interface GiftHandoff {
  chainId: number;
  account: string;
  gemId: string;
  card: CreatedGiftCard;
  recipientName: string;
  recipientEmail?: string;
  message: string;
  template: string;
  /** Persisted before activation begins, immediately after chain confirmation. */
  escrowTxHash?: Hash;
  /**
   * Resumed while the token was still in the sender's wallet. Recovery must
   * offer the transfer rather than try to confirm custody that cannot exist.
   */
  awaitingTransfer?: boolean;
  savedAt: number;
}

export interface GiftHandoffScope {
  chainId: number;
  account: string;
  giftId?: string;
  gemId?: string;
}

const PREFIX = 'dc:gift-handoff:v2:';
const PREPARE_PREFIX = 'dc:gift-prepare:v1:';
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1_000;

function normalizedAccount(account: string): string {
  return account.trim().toLowerCase();
}

export interface GiftPreparationPayload {
  tokenId: string;
  recipientEmail: string;
  recipientName: string;
  message: string;
  template: string;
}

export interface GiftPreparationIntent extends GiftPreparationKey {
  chainId: number;
  account: string;
  gemId: string;
  payload: GiftPreparationPayload;
  savedAt: number;
}

function preparationStorageKey(scope: { chainId: number; account: string; gemId: string }): string {
  return `${PREPARE_PREFIX}${scope.chainId}:${normalizedAccount(scope.account)}:${scope.gemId}`;
}

export function saveGiftPreparationIntent(intent: Omit<GiftPreparationIntent, 'savedAt'>): void {
  try {
    sessionStorage.setItem(
      preparationStorageKey(intent),
      JSON.stringify({
        ...intent,
        account: normalizedAccount(intent.account),
        savedAt: Date.now(),
      }),
    );
  } catch {
    // The caller can still finish while this document remains open.
  }
}

export function inspectGiftPreparationIntent(scope: {
  chainId: number;
  account: string;
  gemId: string;
}): GiftPreparationIntent | undefined {
  try {
    const key = preparationStorageKey(scope);
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as GiftPreparationIntent;
    if (
      Date.now() - parsed.savedAt > MAX_SESSION_AGE_MS ||
      !parsed.clientRequestId ||
      !parsed.code ||
      !parsed.payload ||
      !/^\d+$/.test(parsed.payload.tokenId) ||
      !parsed.payload.recipientEmail ||
      !['classic', 'noir', 'celebration'].includes(parsed.payload.template)
    ) {
      sessionStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function clearGiftPreparationIntent(scope: {
  chainId: number;
  account: string;
  gemId: string;
}): void {
  try {
    sessionStorage.removeItem(preparationStorageKey(scope));
  } catch {
    // Nothing to clear.
  }
}

function keyFor(scope: Pick<GiftHandoff, 'chainId' | 'account' | 'card'>): string {
  return `${PREFIX}${scope.chainId}:${normalizedAccount(scope.account)}:${scope.card.giftId}`;
}

function isExpired(handoff: GiftHandoff): boolean {
  const expiresAt = new Date(handoff.card.expiresAt).getTime();
  return (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    Date.now() - handoff.savedAt > MAX_SESSION_AGE_MS
  );
}

function read(key: string): GiftHandoff | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as GiftHandoff;
    if (
      !parsed?.card?.giftId ||
      !parsed.card.code ||
      !Number.isSafeInteger(parsed.chainId) ||
      !parsed.account
    ) {
      sessionStorage.removeItem(key);
      return undefined;
    }
    if (isExpired(parsed)) {
      sessionStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function scopedKeys(chainId: number, account: string): string[] {
  const prefix = `${PREFIX}${chainId}:${normalizedAccount(account)}:`;
  const keys: string[] = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** Save or update one card without disturbing other pending cards. */
export function saveGiftHandoff(handoff: Omit<GiftHandoff, 'savedAt'>): void {
  try {
    const value: GiftHandoff = {
      ...handoff,
      account: normalizedAccount(handoff.account),
      savedAt: Date.now(),
    };
    sessionStorage.setItem(keyFor(value), JSON.stringify(value));
  } catch {
    // Private mode or a full quota. The caller still retains the in-memory code.
  }
}

/** Non-destructive inspection; recovery stays available across remounts. */
export function inspectGiftHandoff(scope: GiftHandoffScope): GiftHandoff | undefined {
  const account = normalizedAccount(scope.account);
  try {
    for (const key of scopedKeys(scope.chainId, account)) {
      const handoff = read(key);
      if (!handoff) continue;
      if (scope.giftId && handoff.card.giftId !== scope.giftId) continue;
      if (scope.gemId && handoff.gemId !== scope.gemId) continue;
      return handoff;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function listGiftHandoffs(scope: Pick<GiftHandoffScope, 'chainId' | 'account'>) {
  const account = normalizedAccount(scope.account);
  const records: GiftHandoff[] = [];
  try {
    for (const key of scopedKeys(scope.chainId, account)) {
      const handoff = read(key);
      if (handoff) records.push(handoff);
    }
  } catch {
    return records;
  }
  return records.sort((left, right) => right.savedAt - left.savedAt);
}

/** Remove only the completed/discarded card. */
export function clearGiftHandoff(scope: GiftHandoffScope): void {
  const handoff = inspectGiftHandoff(scope);
  if (!handoff) return;
  try {
    sessionStorage.removeItem(keyFor(handoff));
  } catch {
    // Nothing to do; an unreadable store is also an unwritable one.
  }
}
