import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthShell } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Field, OrDivider } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

const schema = z.object({
  fullName: z.string().min(2, 'Enter your full name.'),
  email: z.string().email('Enter a valid email address.'),
});

export default function SignupPage() {
  const {
    configured,
    loading,
    user,
    googleAuthAvailable,
    authError,
    signInWithGoogle,
    signUpWithEmail,
  } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onGoogle() {
    setErrors({});
    setBusy('google');
    const result = await signInWithGoogle();
    setBusy(null);
    if (!result.ok) setErrors({ google: result.message });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => (errs[i.path[0] as string] = i.message));
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy('email');
    const res = await signUpWithEmail(form.email, form.fullName);
    setBusy(null);
    if (res.ok) setNotice(res.message);
    else setErrors({ email: res.message });
  }

  return (
    <AuthShell>
      <div className="dc-surface dc-facet-border w-full max-w-[440px] rounded-[4px] p-7 shadow-lift sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
          Join the vault
        </p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">
          Create your account
        </h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Browse, buy, bid and swap freely — no KYC required.
        </p>

        {!configured && (
          <div className="mt-4 rounded-[4px] border border-line/[0.1] bg-line/[0.03] px-3 py-2 text-[12px] text-ink-dim">
            Auth is not configured. Set <span className="font-mono">VITE_SUPABASE_*</span> env vars
            to enable sign-up.
          </div>
        )}

        <div className="mt-6 space-y-3">
          <GoogleButton
            label="Sign up with Google"
            onClick={() => void onGoogle()}
            disabled={!configured || googleAuthAvailable === false || busy !== null}
            loading={busy === 'google'}
          />
          {configured && googleAuthAvailable === false && (
            <p className="rounded-[4px] border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber">
              Google sign-up is disabled in this Supabase project. Use an email link until the
              provider is enabled.
            </p>
          )}
          {(errors.google || authError) && (
            <p className="rounded-[4px] border border-ruby/25 bg-ruby/[0.07] px-3 py-2 text-[12px] leading-relaxed text-ruby">
              {errors.google ?? authError}
            </p>
          )}
          <OrDivider />
          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              label="Full name"
              placeholder="Ada Verne"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              error={errors.fullName}
            />
            <Field
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              error={errors.email}
            />

            <div className="flex items-start gap-2 rounded-[4px] border border-emerald/25 bg-emerald/[0.06] px-3 py-2.5 text-[12.5px] text-emerald">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" />
              <span>
                Open access for buyers. <strong className="text-ink">Selling</strong> uses the
                Sepolia MVP verification flow; production KYC will be integrated later.
              </span>
            </div>

            <Button type="submit" size="lg" block disabled={busy !== null}>
              {busy === 'email' ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
          {notice && (
            <p className="rounded-[4px] border border-emerald/30 bg-emerald/10 px-3 py-2 text-[12.5px] text-emerald">
              {notice}
            </p>
          )}
        </div>
      </div>

      <p className="mt-6 text-[13px] text-ink-muted">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-ink hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
