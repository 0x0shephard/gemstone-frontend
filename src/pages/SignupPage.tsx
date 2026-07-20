import { useState } from 'react';
import { Link } from 'react-router-dom';
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
  const { configured, signInWithGoogle, signUpWithEmail } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    setBusy(true);
    const res = await signUpWithEmail(form.email, form.fullName);
    setBusy(false);
    if (res.ok) setNotice(res.message);
    else setErrors({ email: res.message });
  }

  return (
    <AuthShell>
      <div className="w-full max-w-[440px] rounded-[16px] border border-white/[0.08] bg-card p-7">
        <h1 className="text-[22px] font-bold text-ink">Create account</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Browse, buy, bid and swap freely — no KYC required.
        </p>

        {!configured && (
          <div className="mt-4 rounded-[10px] border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] text-ink-dim">
            Auth is not configured. Set <span className="font-mono">VITE_SUPABASE_*</span> env vars
            to enable sign-up.
          </div>
        )}

        <div className="mt-6 space-y-3">
          <GoogleButton label="Sign up with Google" onClick={signInWithGoogle} />
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

            <div
              className="flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px]"
              style={{ background: 'rgba(53,185,138,.06)', border: '1px solid rgba(53,185,138,.24)', color: '#9FD9C1' }}
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" />
              <span>
                Open access for buyers. <strong className="text-ink">Redemption and selling</strong>{' '}
                unlock after Sumsub KYC verification.
              </span>
            </div>

            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
          {notice && (
            <p className="rounded-[10px] border border-emerald/30 bg-emerald/10 px-3 py-2 text-[12.5px] text-emerald">
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
