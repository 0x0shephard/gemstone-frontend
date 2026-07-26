import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Field, OrDivider } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

const emailSchema = z.string().email('Enter a valid email address.');

export default function LoginPage() {
  const {
    configured,
    loading,
    user,
    googleAuthAvailable,
    authError,
    signInWithGoogle,
    signInWithEmail,
  } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onGoogle() {
    setError(null);
    setBusy('google');
    const result = await signInWithGoogle();
    setBusy(null);
    if (!result.ok) setError(result.message);
  }

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    setBusy('email');
    const res = await signInWithEmail(email);
    setBusy(null);
    if (res.ok) setNotice(res.message);
    else setError(res.message);
  }

  return (
    <AuthShell>
      <div className="dc-surface dc-facet-border w-full max-w-[400px] rounded-[4px] p-7 shadow-lift sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
          Secure access
        </p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Sign in to manage your vault and trading activity.
        </p>

        {!configured && (
          <div className="mt-4 rounded-[4px] border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] text-ink-dim">
            Auth is not configured. Set <span className="font-mono">VITE_SUPABASE_*</span> env vars
            to enable Google &amp; email sign-in. You can still explore the app.
          </div>
        )}

        <div className="mt-6 space-y-3">
          <GoogleButton
            label="Continue with Google"
            onClick={() => void onGoogle()}
            disabled={!configured || googleAuthAvailable === false || busy !== null}
            loading={busy === 'google'}
          />
          {configured && googleAuthAvailable === false && (
            <p className="rounded-[4px] border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber">
              Google sign-in is disabled in this Supabase project. Use an email link until the
              provider is enabled.
            </p>
          )}
          {!error && authError && (
            <p className="rounded-[4px] border border-ruby/25 bg-ruby/[0.07] px-3 py-2 text-[12px] leading-relaxed text-ruby">
              {authError}
            </p>
          )}
          <OrDivider />
          <form onSubmit={onEmail} className="space-y-3">
            <Field
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error ?? undefined}
            />
            <Button type="submit" size="lg" block disabled={busy !== null}>
              {busy === 'email' ? 'Sending link…' : 'Email me a magic link'}
            </Button>
          </form>
          {notice && (
            <p className="rounded-[4px] border border-emerald/30 bg-emerald/10 px-3 py-2 text-[12.5px] text-emerald">
              {notice}
            </p>
          )}
        </div>

        <button
          onClick={() => navigate('/onboarding')}
          className="mt-4 w-full text-center text-[12.5px] text-ink-muted hover:text-ink"
        >
          Or connect a wallet →
        </button>
      </div>

      <p className="mt-6 text-[13px] text-ink-muted">
        New to Digital Carat?{' '}
        <Link to="/signup" className="font-semibold text-ink hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
