import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/States';
import { completeCanvaAuthorization, consumeCanvaReturn } from '@/services/offchain/canva';

/**
 * Where Canva sends the user back after they authorise.
 *
 * It does nothing but hand the code to the server and get out of the way. The
 * code is single-use and the server deletes the matching PKCE verifier as it
 * reads it, so a reload of this page finds the authorisation already spent —
 * hence the guard against React's double-invoked effects in development, which
 * would otherwise burn the code before the user saw anything.
 */
export default function CanvaCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const denied = searchParams.get('error');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (denied) {
      setError('Canva authorisation was declined.');
      return;
    }
    if (!code || !state) {
      setError('Canva did not return an authorisation code.');
      return;
    }

    completeCanvaAuthorization(code, state)
      .then(() => navigate(consumeCanvaReturn(), { replace: true }))
      .catch((callbackError: unknown) =>
        setError(
          callbackError instanceof Error ? callbackError.message : 'Could not connect Canva.',
        ),
      );
  }, [code, state, denied, navigate]);

  if (error) {
    return (
      <Card className="dc-facet-border mx-auto max-w-[460px] p-7 text-center">
        <h1 className="font-display text-[20px] font-medium text-ink">Canva was not connected</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{error}</p>
        <Button
          className="mt-5"
          variant="secondary"
          onClick={() => navigate(consumeCanvaReturn(), { replace: true })}
        >
          Back to your portfolio
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-[460px] space-y-3 text-center">
      <Skeleton className="h-32" />
      <p className="text-[13px] text-ink-muted">Connecting your Canva account…</p>
    </div>
  );
}
