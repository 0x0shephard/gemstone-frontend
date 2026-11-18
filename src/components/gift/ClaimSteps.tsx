import { useState, type ReactNode } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { useAuth } from '@/providers/AuthProvider';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { Skeleton } from '@/components/ui/States';
import { activeChain } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { cn } from '@/lib/cn';

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-4 p-5">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold',
          done
            ? 'border-emerald/40 bg-emerald/[0.12] text-emerald'
            : 'border-line/[0.14] text-ink-muted',
        )}
      >
        {done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className={cn('text-[14px] font-semibold', done ? 'text-ink-muted' : 'text-ink')}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Verify an email, verify a wallet, then claim: shared by gift cards and
 * promotional codes, which both release a token from operator escrow to the
 * signed-in person's verified wallet.
 */
export function ClaimSteps({
  returnTo,
  emailHint,
  claimHint,
  claimLabel = 'Claim the token',
  onClaim,
}: {
  /** Where the sign-in link and Google sign-in return to. */
  returnTo: string;
  emailHint: ReactNode;
  claimHint: ReactNode;
  claimLabel?: string;
  /** Performs the claim; a thrown error is shown under the steps. */
  onClaim: () => Promise<void>;
}) {
  const { user, loading, linkedWallet, googleAuthAvailable, signInWithEmail, signInWithGoogle } =
    useAuth();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { linkWallet } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailVerified = Boolean(user?.email);
  const walletVerified = Boolean(address && linkedWallet?.toLowerCase() === address.toLowerCase());
  const wrongNetwork = isConnected && chainId !== activeChain.id;

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy('email');
    const result = await signInWithEmail(email.trim(), returnTo);
    setBusy(null);
    if (result.ok) setNotice(result.message);
    else setError(result.message);
  }

  async function verifyWallet(walletAddress: Address) {
    setError(null);
    setBusy('wallet');
    let result = await linkWallet(walletAddress);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm(
        'This account already has a primary wallet. Receive the token in the connected wallet instead?',
      );
      result = confirmed
        ? await linkWallet(walletAddress, true)
        : { ok: false, message: 'Keeping the existing wallet.' };
    }
    setBusy(null);
    if (result.ok) setNotice(result.message);
    else setError(result.message);
  }

  async function claim() {
    setError(null);
    setBusy('claim');
    try {
      await onClaim();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Could not claim the token');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Skeleton className="h-52" />;

  return (
    <Card className="dc-facet-border divide-y divide-line/[0.06] p-0">
      <Step index={1} title="Verify your email" done={emailVerified}>
        {emailVerified ? (
          <p className="text-[12.5px] text-ink-muted">Signed in as {user!.email}</p>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-muted">{emailHint}</p>
            <GoogleButton
              label="Continue with Google"
              onClick={() => void signInWithGoogle(returnTo)}
              disabled={googleAuthAvailable === false || busy !== null}
              loading={busy === 'google'}
            />
            <form onSubmit={sendLink} className="space-y-2.5">
              <Field
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button type="submit" block variant="secondary" disabled={busy !== null}>
                {busy === 'email' ? 'Sending link…' : 'Email me a sign-in link'}
              </Button>
            </form>
          </>
        )}
      </Step>

      <Step index={2} title="Choose where it goes" done={walletVerified}>
        {walletVerified ? (
          <p className="font-mono text-[12.5px] text-ink-muted">{shortenAddress(address!)}</p>
        ) : !emailVerified ? (
          <p className="text-[12.5px] text-ink-dim">Verify your email first.</p>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              The token is released from escrow straight to a wallet you control. Connect one and
              sign a message to prove it is yours — no transaction, no gas.
            </p>
            {!isConnected ? (
              <Button block variant="secondary" onClick={openConnectModal}>
                Connect a wallet
              </Button>
            ) : wrongNetwork ? (
              <p className="text-[12.5px] text-amber">
                Switch your wallet to {activeChain.name} to continue.
              </p>
            ) : (
              <Button
                block
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void verifyWallet(address!)}
              >
                {busy === 'wallet'
                  ? 'Waiting for signature…'
                  : `Verify ${shortenAddress(address!)}`}
              </Button>
            )}
          </>
        )}
      </Step>

      <Step index={3} title="Claim your gemstone" done={false}>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{claimHint}</p>
        <Button
          block
          disabled={!emailVerified || !walletVerified || busy !== null}
          onClick={() => void claim()}
        >
          {busy === 'claim' ? 'Transferring…' : claimLabel}
        </Button>
      </Step>

      {(notice || error) && (
        <div className="p-5">
          {notice && !error && (
            <p className="rounded-[4px] border border-emerald/30 bg-emerald/10 px-3 py-2 text-[12.5px] text-emerald">
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-[4px] border border-ruby/25 bg-ruby/[0.07] px-3 py-2 text-[12.5px] leading-relaxed text-ruby"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
