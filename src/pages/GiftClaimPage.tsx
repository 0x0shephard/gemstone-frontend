import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGem } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/States';
import { ClaimSteps } from '@/components/gift/ClaimSteps';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { useClaimFunnel } from '@/hooks/useClaimFunnel';
import { claimGiftCard, inspectGiftCard, type GiftCardSummary } from '@/services/offchain/gift';

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
  const report = useClaimFunnel('gift', undefined, Boolean(card));

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
        <ClaimSteps
          returnTo={`${window.location.origin}/gift/${code}`}
          emailHint={
            <>
              This card was issued to <span className="font-mono">{card.recipientEmailMasked}</span>
              . Sign in with that address to prove it is yours — it is the only thing standing
              between a printed card and whoever else might pick it up.
            </>
          }
          claimHint="Digital Carat releases the token from escrow to your wallet. There is nothing to pay."
          onClaim={async () => {
            const claimed = await claimGiftCard(code);
            report('completed', claimed.state);
            setCard(claimed);
          }}
          onProgress={report}
        />
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
    pending: {
      title: 'The gift is being secured',
      body: 'The sender prepared this card but has not finished moving the gemstone into escrow. Try again after they complete the transfer.',
      tone: 'neutral',
    },
    claiming: {
      title: 'Claim submitted',
      body: 'The transfer was submitted and is still being checked. Do not claim again; reopen this card shortly to reconcile the same transaction.',
      tone: 'neutral',
    },
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
    cancelling: {
      title: 'Return in progress',
      body: 'The sender has submitted the escrow return. This card cannot be claimed while that transaction is being checked.',
      tone: 'neutral',
    },
    expired: {
      title: 'This card has expired',
      body: "A card stays claimable until the end of the gemstone's reserve escrow term. That date has passed. If this was an escrowed gift, the sender can cancel it to return the gemstone to their wallet.",
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
