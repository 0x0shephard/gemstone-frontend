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
import { getAddress, type Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { useSignMessage } from 'wagmi';
import { supabase } from './supabase';
import { queryClient } from './queryClient';
import { disablePush } from '@/services/offchain/push';
import { authConfigured, env } from '@/config/env';
import { friendlyAuthError, oauthRedirectError, type AuthActionResult } from '@/lib/auth';
import { functionErrorMessage, functionResponseBody } from '@/lib/supabaseFunctions';

export interface AuthState {
  /** Whether Supabase env is present. When false, auth actions are disabled. */
  configured: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  googleAuthAvailable: boolean | null;
  authError: string | null;
  /** Server-verified primary wallet. */
  linkedWallet: string | null;
  /**
   * `redirectTo` lets a page that is itself the destination — the gift claim
   * page, say — bring the user back to where they were rather than dropping
   * them at onboarding with no way to find the link they arrived on.
   */
  signInWithGoogle: (redirectTo?: string) => Promise<AuthActionResult>;
  signInWithEmail: (
    email: string,
    redirectTo?: string,
  ) => Promise<{ ok: boolean; message: string }>;
  signUpWithEmail: (email: string, fullName: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  linkWallet: (
    address: Address,
    confirmRelink?: boolean,
  ) => Promise<{ ok: boolean; message: string; requiresConfirmation?: boolean }>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [linkedWallet, setLinkedWallet] = useState<string | null>(null);
  const [googleAuthAvailable, setGoogleAuthAvailable] = useState<boolean | null>(
    authConfigured ? null : false,
  );
  const [authError, setAuthError] = useState<string | null>(() =>
    oauthRedirectError(window.location.hash),
  );

  const loadPrimaryWallet = useCallback(async (profileId: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('wallet_links')
      .select('wallet_address')
      .eq('profile_id', profileId)
      .eq('is_primary', true)
      .not('verified_at', 'is', null)
      .maybeSingle();
    setLinkedWallet(data?.wallet_address ?? null);
  }, []);

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
      if (data.session?.user) void loadPrimaryWallet(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) void loadPrimaryWallet(s.user.id);
      else setLinkedWallet(null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadPrimaryWallet]);

  useEffect(() => {
    if (!authConfigured) return;
    const controller = new AbortController();
    void fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Auth settings returned ${response.status}`);
        return response.json() as Promise<{ external?: { google?: boolean } }>;
      })
      .then((settings) => setGoogleAuthAvailable(settings.external?.google === true))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Unknown availability should not block an OAuth attempt.
        setGoogleAuthAvailable(null);
      });
    return () => controller.abort();
  }, []);

  const signInWithGoogle = useCallback(
    async (redirectTo?: string) => {
      if (!supabase) return { ok: false, message: 'Auth is not configured.' };
      if (googleAuthAvailable === false) {
        const message = friendlyAuthError('Unsupported provider: provider is not enabled');
        setAuthError(message);
        return { ok: false, message };
      }
      try {
        setAuthError(null);
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: redirectTo ?? `${window.location.origin}/onboarding` },
        });
        if (error) {
          const message = friendlyAuthError(error);
          setAuthError(message);
          return { ok: false, message };
        }
        return { ok: true, message: 'Redirecting to Google…' };
      } catch (error) {
        const message = friendlyAuthError(error);
        setAuthError(message);
        return { ok: false, message };
      }
    },
    [googleAuthAvailable],
  );

  const signInWithEmail = useCallback(async (email: string, redirectTo?: string) => {
    if (!supabase) return { ok: false, message: 'Auth is not configured.' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo ?? `${window.location.origin}/onboarding` },
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
    /*
     * The device stops being this account's, and this has to happen first.
     *
     * A push subscription is keyed by endpoint, which identifies the browser
     * rather than the person. Left in place, the row still names the account
     * that signed out while the device now belongs to whoever signs in next, so
     * notifications meant for one person surface on another's screen. Clearing
     * the query cache does nothing about it, because the subscription is server
     * state — and removing the row goes through RLS, so it only works while the
     * session that owns it still exists.
     *
     * Best-effort: a failure here must not leave someone still signed in.
     */
    await disablePush().catch(() => undefined);

    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setLinkedWallet(null);
    /*
     * Everything the previous account fetched, gone with them.
     *
     * React Query caches by key, and a key that does not name the account is
     * shared by every account that uses this tab. Gift cards were the clearest
     * case — recipient names, email addresses and personal messages under a
     * plain `['giftCards']` — but the same applies to redemption delivery
     * addresses and anything else added later.
     *
     * Cleared wholesale rather than key by key: a list of what to forget is a
     * list that the next feature forgets to join.
     */
    queryClient.clear();
  }, []);

  const linkWallet = useCallback(
    async (address: Address, confirmRelink = false) => {
      if (!supabase || !user) return { ok: false, message: 'Sign in before linking a wallet.' };
      const domain = window.location.host;
      const uri = window.location.origin;
      const { data: nonceData, error: nonceError } = await supabase.functions.invoke(
        'v1-siwe-nonce',
        { body: { domain, uri, chainId: env.chainId } },
      );
      if (nonceError || !nonceData?.nonce) {
        return {
          ok: false,
          message: await functionErrorMessage(
            nonceError,
            nonceData,
            'Could not issue a SIWE nonce.',
          ),
        };
      }
      const issuedAt = new Date();
      const expirationTime = new Date(nonceData.expiresAt);
      const message = createSiweMessage({
        address: getAddress(address),
        chainId: env.chainId,
        domain,
        uri,
        version: '1',
        nonce: nonceData.nonce,
        statement: 'Link this wallet as your verified Digital Carat primary wallet.',
        issuedAt,
        expirationTime,
      });
      try {
        const signature = await signMessageAsync({ message });
        const { data, error } = await supabase.functions.invoke('v1-siwe-verify', {
          body: { message, signature, confirmRelink },
        });
        if (error || data?.error) {
          /*
           * Read from the response rather than from `data`. A 409 leaves `data`
           * null and puts the body on the error, so this flag was always false —
           * the caller never learned the server was asking a question, showed
           * the refusal as final, and left no way to relink a wallet at all.
           */
          const body = await functionResponseBody(error, data);
          return {
            ok: false,
            message: await functionErrorMessage(error, data, 'Wallet verification failed.'),
            requiresConfirmation: body?.requiresConfirmation === true,
          };
        }
        setLinkedWallet(data.wallet_address);
        return { ok: true, message: 'Wallet verified.' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Signature rejected.',
        };
      }
    },
    [signMessageAsync, user],
  );

  const value = useMemo<AuthState>(
    () => ({
      configured: authConfigured,
      loading,
      user,
      session,
      googleAuthAvailable,
      authError,
      linkedWallet,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      linkWallet,
    }),
    [
      loading,
      user,
      session,
      googleAuthAvailable,
      authError,
      linkedWallet,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      linkWallet,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
