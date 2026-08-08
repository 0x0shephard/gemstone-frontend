import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { useAuth } from '@/providers/AuthProvider';
import { useGem } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/States';
import { activeChain, explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { claimGiftCard, inspectGiftCard, type GiftCardSummary } from '@/services/offchain/gift';
import { cn } from '@/lib/cn';

/**
 * The page a gift card's QR code points at.
 *
 * It has to work for someone who has never heard of this protocol, arriving
 * from a printed card with no account and no wallet, so it shows what the gift
 * is before it asks for anything — and then asks for exactly two things, in the
 * order that makes them make sense: prove the email the card was issued to,
 * then say where the token should go.
 */
export default function GiftClaimPage() {
  const { code = '' } = useParams();
  const [card, setCard] = useState<GiftCardSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    inspectGiftCard(code)
      .then(setCard)
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : 'That gift code is not valid'),
      );
  }, [code]);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <Card className="dc-facet-border mx-auto max-w-[520px] p-7 text-center">
        <h1 className="font-display text-[22px] font-medium text-ink">
          This card cannot be opened
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{loadError}</p>
        <p className="mt-3 text-[12px] text-ink-dim">
          Check the code printed under the QR — it is four groups of four characters.
        </p>
      </Card>
    );
  }

  if (!card) return <Skeleton className="mx-auto h-[420px] max-w-[720px]" />;

  return (
    <div className="mx-auto max-w-[720px] space-y-5">
      <GiftHeader card={card} />
      {card.state === 'active' ? (
        <ClaimSteps card={card} code={code} onClaimed={setCard} />
      ) : (
        <TerminalState card={card} />
      )}
    </div>
  );
}

function GiftHeader({ card }: { card: GiftCardSummary }) {
  const { data: gem } = useGem(card.gemId ?? '');

  return (
    <Card className="dc-facet-border overflow-hidden p-0">
      <div className="dc-dot-grid border-b border-line/[0.07] px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
          Digital Carat gift card
        </p>
        <h1 className="mt-1.5 font-display text-[26px] font-medium tracking-[-0.03em] text-ink">
          {card.recipientName ? `${card.recipientName}, ` : ''}someone sent you a gemstone
        </h1>
        <p className="mt-1 text-[13px] text-ink-muted">From {card.senderName}</p>
      </div>

      <div className="flex flex-col gap-5 p-6 sm:flex-row">
        {gem ? (
          <GemThumb gem={gem} height={160} rounded="rounded-[4px]" className="sm:w-[220px]" />
        ) : (
          <Skeleton className="h-[160px] sm:w-[220px]" />
        )}
        <div className="min-w-0 flex-1 space-y-2.5">
          {gem ? (
            <>
              <div className="font-display text-[19px] font-medium text-ink">{gem.name}</div>
              <div className="font-mono text-[11.5px] text-ink-dim">{gem.displayId}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <StatusBadge color={gem.color}>{gem.typeLabel}</StatusBadge>
                <StatusBadge tone="neutral">{gem.caratsFmt}</StatusBadge>
                <StatusBadge tone="neutral">{gem.valueFmt}</StatusBadge>
              </div>
            </>
          ) : (
            <div className="text-[13px] text-ink-muted">Token #{card.tokenId}</div>
          )}
          {card.message && (
            <p className="border-l-2 border-atelier/40 pl-3 text-[13.5px] italic leading-relaxed text-ink-soft">
              “{card.message}”
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function TerminalState({ card }: { card: GiftCardSummary }) {
  const copy: Record<string, { title: string; body: string; tone: 'success' | 'neutral' }> = {
    claimed: {
      title: 'Already claimed',
      body: card.transactionHash
        ? 'This card has been redeemed and the token has moved to its new owner.'
        : 'This card has been redeemed.',
      tone: 'success',
    },
    cancelled: {
      title: 'Cancelled by the sender',
      body: 'The sender withdrew this card. If it was meant for you, ask them to issue a new one.',
      tone: 'neutral',
    },
    expired: {
      title: 'This card has expired',
      body: "A card stays claimable until the end of the gemstone's reserve escrow term. That date has passed. The gemstone was never taken from the sender, so they still hold it.",
      tone: 'neutral',
    },
  };
  const state = copy[card.state] ?? copy.expired;

  return (
    <Card className="dc-facet-border p-6">
      <StatusBadge tone={state.tone} dot>
        {state.title}
      </StatusBadge>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{state.body}</p>
      {card.transactionHash && (
        <a
          href={explorerTxUrl(card.transactionHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block font-mono text-[12px] text-emerald hover:underline"
        >
          {shortenAddress(card.transactionHash, 8)} ↗
        </a>
      )}
    </Card>
  );
}

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children?: React.ReactNode;
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

function ClaimSteps({
  card,
  code,
  onClaimed,
}: {
  card: GiftCardSummary;
  code: string;
  onClaimed: (card: GiftCardSummary) => void;
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

  const returnTo = `${window.location.origin}/gift/${code}`;
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
        'This account already has a primary wallet. Receive the gift in the connected wallet instead?',
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
      onClaimed(await claimGiftCard(code));
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Could not claim the gift card');
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
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              This card was issued to <span className="font-mono">{card.recipientEmailMasked}</span>
              . Sign in with that address to prove it is yours — it is the only thing standing
              between a printed card and whoever else might pick it up.
            </p>
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
              The token is transferred straight to a wallet you control. Connect one and sign a
              message to prove it is yours — no transaction, no gas.
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
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          Digital Carat moves the token from the sender to your wallet. There is nothing to pay.
        </p>
        <Button
          block
          disabled={!emailVerified || !walletVerified || busy !== null}
          onClick={() => void claim()}
        >
          {busy === 'claim' ? 'Transferring…' : 'Claim the token'}
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
