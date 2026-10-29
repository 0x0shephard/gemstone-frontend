import { Suspense, lazy, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { KycStatus } from '@/hooks/useKyc';
import { startKycSession, type KycSession } from '@/services/offchain/kycSession';

// The WebSDK is large and only needed once someone actually starts verifying.
const SumsubWebSdk = lazy(() => import('@sumsub/websdk-react'));

/** Statuses from which a person can (re)start verification. */
const STARTABLE: ReadonlySet<KycStatus> = new Set(['not_started', 'rejected', 'pending']);

export function kycButtonLabel(status: KycStatus): string | undefined {
  if (!STARTABLE.has(status)) return undefined;
  return status === 'pending' ? 'Continue verification' : 'Verify identity';
}

/**
 * Opens Sumsub identity verification in a modal.
 *
 * Nothing in the app started KYC before: the status pill existed, but no
 * control ever asked for a token. The decision arrives later by webhook, so on
 * close the status query is refreshed rather than assumed.
 */
export function KycVerifyButton({ status }: { status: KycStatus }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<KycSession>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const label = kycButtonLabel(status);
  if (!label) return null;

  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      setSession(await startKycSession());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity verification could not start.');
    } finally {
      setStarting(false);
    }
  };

  const close = () => {
    setSession(undefined);
    void queryClient.invalidateQueries({ queryKey: ['kyc-status'] });
  };

  return (
    <>
      <Button size="sm" variant="secondary" disabled={starting} onClick={() => void start()}>
        {starting ? 'Starting…' : label}
      </Button>
      {error && (
        <p role="alert" className="basis-full text-[11.5px] text-ruby">
          {error}
        </p>
      )}
      {session && (
        <Modal
          open
          onClose={close}
          title="Verify your identity"
          subtitle="Handled by Sumsub. Your documents go to them, not to Digital Carat."
          maxWidth={720}
        >
          <Suspense fallback={<p className="text-[12px] text-ink-muted">Loading verification…</p>}>
            <SumsubWebSdk
              accessToken={session.accessToken}
              expirationHandler={session.refreshToken}
              onError={() => setError('Identity verification ran into a problem. Try again.')}
            />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
