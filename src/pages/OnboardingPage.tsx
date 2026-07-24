import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

/**
 * OAuth and magic-link return route. Wallet setup now lives exclusively in
 * the account menu so a completed session can move straight to the homepage.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, loading, authError } = useAuth();

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, navigate, user]);

  return (
    <AuthShell>
      <div className="dc-surface dc-facet-border w-full max-w-[440px] rounded-[22px] p-7 text-center shadow-lift sm:p-8">
        {loading || user ? (
          <>
            <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-white/[0.12] border-t-atelier" />
            <h1 className="mt-5 text-[22px] font-semibold tracking-tight text-ink">
              Finishing sign-in
            </h1>
            <p className="mt-2 text-[13px] text-ink-muted">
              Your secure session is ready. Taking you home…
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
              Account access
            </p>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-ink">
              Sign in to continue
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              Connect and verify your trading wallet later from the account menu in the header.
            </p>
            {authError && (
              <p className="mt-4 rounded-[10px] border border-ruby/25 bg-ruby/[0.07] px-3 py-2 text-[12px] leading-relaxed text-ruby">
                {authError}
              </p>
            )}
            <Link to="/login" className="mt-6 block">
              <Button size="lg" block>
                Sign in
              </Button>
            </Link>
            <Link to="/" className="mt-3 inline-block text-[12.5px] text-ink-muted hover:text-ink">
              Return home
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
