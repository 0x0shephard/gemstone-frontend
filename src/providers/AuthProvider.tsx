import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { authConfigured } from '@/config/env';

export interface AuthState {
  /** Whether Supabase env is present. When false, auth actions are disabled. */
  configured: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  /** Wallet address linked to the profile (persisted locally as a fallback). */
  linkedWallet: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
  signUpWithEmail: (
    email: string,
    fullName: string,
  ) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  linkWallet: (address: string) => Promise<void>;
}

const LINKED_WALLET_KEY = 'dc.linkedWallet';

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [linkedWallet, setLinkedWallet] = useState<string | null>(
    () => localStorage.getItem(LINKED_WALLET_KEY),
  );

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/onboarding` },
    });
  }, []);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!supabase) return { ok: false, message: 'Auth is not configured.' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    return error
      ? { ok: false, message: error.message }
      : { ok: true, message: 'Check your inbox for a magic sign-in link.' };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, fullName: string) => {
    if (!supabase) return { ok: false, message: 'Auth is not configured.' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
        data: { full_name: fullName },
      },
    });
    return error
      ? { ok: false, message: error.message }
      : { ok: true, message: 'Account created — check your inbox to verify your email.' };
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  const linkWallet = useCallback(async (address: string) => {
    setLinkedWallet(address);
    localStorage.setItem(LINKED_WALLET_KEY, address);
    // Best-effort persistence to a `profiles` row when auth is live.
    if (supabase && user) {
      await supabase
        .from('profiles')
        .upsert({ id: user.id, wallet_address: address })
        .then(() => undefined, () => undefined);
    }
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      configured: authConfigured,
      loading,
      user,
      session,
      linkedWallet,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      linkWallet,
    }),
    [loading, user, session, linkedWallet, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, linkWallet],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
