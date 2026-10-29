import type { Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { accountSession } from './AuthProvider';

const session = (user: Record<string, unknown>) => ({ user }) as unknown as Session;

describe('accountSession', () => {
  it('keeps a normal session', () => {
    const normal = session({ id: 'u1', is_anonymous: false });
    expect(accountSession(normal)).toBe(normal);
    const legacy = session({ id: 'u2' });
    expect(accountSession(legacy)).toBe(legacy);
  });

  it('treats an anonymous sign-in as signed out', () => {
    expect(accountSession(session({ id: 'anon', is_anonymous: true }))).toBeNull();
  });

  it('passes no session through', () => {
    expect(accountSession(null)).toBeNull();
  });
});
