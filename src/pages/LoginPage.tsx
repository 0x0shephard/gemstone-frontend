import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Field, OrDivider } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

const emailSchema = z.string().email('Enter a valid email address.');

export default function LoginPage() {
  const { configured, signInWithGoogle, signInWithEmail } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    setBusy(true);
    const res = await signInWithEmail(email);
    setBusy(false);
    res.ok ? setNotice(res.message) : setError(res.message);
  }

  return (
    <AuthShell>
      <div className="w-full max-w-[380px] rounded-[16px] border border-white/[0.08] bg-card p-7">
        <h1 className="text-[22px] font-bold text-ink">Sign in</h1>
        <p className="mt-1 text-[13px] text-ink-muted">Access your gemstone portfolio.</p>

        {!configured && (
          <div className="mt-4 rounded-[10px] border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] text-ink-dim">
            Auth is not configured. Set <span className="font-mono">VITE_SUPABASE_*</span> env vars
            to enable Google &amp; email sign-in. You can still explore the app.
          </div>
        )}

        <div className="mt-6 space-y-3">
          <GoogleButton label="Continue with Google" onClick={signInWithGoogle} />
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
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? 'Sending link…' : 'Email me a magic link'}
            </Button>
          </form>
          {notice && (
            <p className="rounded-[10px] border border-emerald/30 bg-emerald/10 px-3 py-2 text-[12.5px] text-emerald">
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
