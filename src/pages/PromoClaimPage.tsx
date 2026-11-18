import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGem } from '@/hooks/useData';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { GemThumb } from '@/components/gem/GemThumb';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/States';
import { ClaimSteps } from '@/components/gift/ClaimSteps';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import {
  claimPromo,
  inspectPromo,
  type PromoClaimResult,
  type PromoSummary,
} from '@/services/offchain/promo';

/**
 * Where a promotional QR code points: /claim?code=FIRST100.
 *
 * Public, like the gift page: it shows what is on offer before asking for an
 * email and a wallet. Each account, email and wallet gets one stone per code.
 */
export default function PromoClaimPage() {
  const [params, setParams] = useSearchParams();
  const code = (params.get('code') ?? '').trim();
  const [promo, setPromo] = useState<PromoSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<PromoClaimResult | null>(null);

  const load = useCallback(() => {
    if (!code) return;
    setLoadError(null);
    setPromo(null);
    inspectPromo(code)
      .then(setPromo)
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : 'That code is not valid'),
      );
  }, [code]);

  useEffect(load, [load]);

  if (!code || loadError) {
    return <CodeEntry error={loadError} onCode={(next) => setParams({ code: next })} />;
  }
  if (!promo) return <Skeleton className="mx-auto h-[420px] max-w-[720px]" />;

  return (
    <div className="mx-auto max-w-[720px] space-y-5">
      <PromoHeader promo={promo} gemId={result?.gemId ?? promo.sampleGemId} />
      {result ? (
        <ClaimResult result={result} />
      ) : promo.state === 'open' ? (
        <ClaimSteps
          returnTo={`${window.location.origin}/claim?code=${encodeURIComponent(promo.code)}`}
          emailHint="Sign in with your email address. Each email, account and wallet can claim one stone with this code."
          claimHint="Digital Carat transfers the token from escrow to your wallet. There is nothing to pay, and it appears in your portfolio once the transfer confirms."
          claimLabel="Claim my free stone"
          onClaim={async () => setResult(await claimPromo(promo.code))}
        />
      ) : (
        <Card className="dc-facet-border p-6">
          <StatusBadge tone="neutral" dot>
            {promo.state === 'sold_out' ? 'All stones claimed' : 'Promotion ended'}
          </StatusBadge>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
            {promo.state === 'sold_out'
              ? 'Every stone in this promotion has been claimed.'
              : 'This code is no longer active.'}{' '}
            You can still browse the{' '}
            <Link to="/marketplace" className="text-emerald hover:underline">
              marketplace
            </Link>
            .
          </p>
        </Card>
      )}
    </div>
  );
}

function CodeEntry({ error, onCode }: { error: string | null; onCode: (code: string) => void }) {
  const [value, setValue] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onCode(value.trim());
  }
  return (
    <Card className="dc-facet-border mx-auto max-w-[520px] p-7">
      <h1 className="font-display text-[22px] font-medium text-ink">Claim a stone</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        Enter the code from your invitation.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-2.5">
        <Field
          placeholder="FIRST100"
          autoCapitalize="characters"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" block disabled={!value.trim()}>
          Continue
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-ruby">
          {error}
        </p>
      )}
    </Card>
  );
}

function PromoHeader({ promo, gemId }: { promo: PromoSummary; gemId: string | null }) {
  const { data: gem } = useGem(gemId ?? '');
  return (
    <Card className="dc-facet-border overflow-hidden p-0">
      <div className="dc-dot-grid border-b border-line/[0.07] px-6 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
          Digital Carat · code {promo.code}
        </p>
        <h1 className="mt-1.5 font-display text-[26px] font-medium tracking-[-0.03em] text-ink">
          {promo.title}
        </h1>
        {promo.state === 'open' && (
          <p className="mt-1 text-[13px] text-ink-muted">
            {promo.remaining} {promo.remaining === 1 ? 'stone' : 'stones'} left
          </p>
        )}
      </div>
      <div className="flex flex-col gap-5 p-6 sm:flex-row">
        {gem ? (
          <GemThumb gem={gem} height={160} rounded="rounded-[4px]" className="sm:w-[220px]" />
        ) : gemId ? (
          <Skeleton className="h-[160px] sm:w-[220px]" />
        ) : null}
        <div className="min-w-0 flex-1 space-y-2.5">
          {gem && (
            <>
              <div className="font-display text-[19px] font-medium text-ink">{gem.name}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <StatusBadge color={gem.color}>{gem.typeLabel}</StatusBadge>
                <StatusBadge tone="neutral">{gem.caratsFmt}</StatusBadge>
                <StatusBadge tone="neutral">{gem.valueFmt}</StatusBadge>
              </div>
            </>
          )}
          {promo.message && (
            <p className="text-[13.5px] leading-relaxed text-ink-soft">{promo.message}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function ClaimResult({ result }: { result: PromoClaimResult }) {
  const done = result.state === 'claimed';
  return (
    <Card className="dc-facet-border p-6">
      <StatusBadge tone={done ? 'success' : 'neutral'} dot>
        {done ? 'Your stone is in your wallet' : 'Transfer submitted'}
      </StatusBadge>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        {done
          ? 'Token #' +
            result.tokenId +
            ' now belongs to you. You can see it in your portfolio, and redeem the physical stone from there.'
          : 'The transfer is still being confirmed. Do not claim again; reopen this page shortly to check on it.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {done && (
          <Link to="/profile">
            <Button>Open my portfolio</Button>
          </Link>
        )}
        {result.transactionHash && (
          <a
            href={explorerTxUrl(result.transactionHash)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] text-emerald hover:underline"
          >
            {shortenAddress(result.transactionHash, 8)} ↗
          </a>
        )}
      </div>
    </Card>
  );
}
