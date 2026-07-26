import type { DecoratedGem } from '@/services/types';
import { cn } from '@/lib/cn';

interface ProvenanceChainProps {
  gem: DecoratedGem;
  className?: string;
}

interface Gate {
  title: string;
  detail: string;
  actor: string;
  done: boolean;
}

/**
 * The gates a gemstone clears before a token can exist.
 *
 * `GemRegistry` blocks minting until seller approval, custody confirmation,
 * verification and listing have each passed under a different role. Showing the
 * chain is the clearest way to explain why the token is worth trusting.
 *
 * Detail lines are derived only from fields the data model actually carries.
 * Certificate and valuation hash commitments are deliberately not rendered here
 * rather than shown as placeholders.
 */
export function ProvenanceChain({ gem, className }: ProvenanceChainProps) {
  const minted = Boolean(gem.tokenId);
  const listed = minted || Boolean(gem.market);

  const gates: Gate[] = [
    {
      title: 'Registered',
      detail: `${gem.displayId} · ${gem.typeLabel}`,
      actor: 'Lister',
      done: true,
    },
    {
      title: 'Custody confirmed',
      detail: `${gem.custodyProvider}, ${gem.custodyCountry}`,
      actor: 'Custodian',
      done: true,
    },
    {
      title: 'Valuation approved',
      detail: `${gem.valueFmt} · ${gem.caratsFmt}`,
      actor: 'Verifier',
      done: true,
    },
    {
      title: 'Listed at approved valuation',
      detail: listed
        ? `Published on the ${gem.market === 'secondary' ? 'secondary' : 'primary'} market`
        : 'Not published yet',
      actor: 'Lister',
      done: listed,
    },
    {
      title: 'Minted to holder',
      detail: minted ? `Token ${gem.tokenId}` : 'No token exists yet',
      actor: 'Primary sale',
      done: minted,
    },
  ];

  const nextIndex = gates.findIndex((g) => !g.done);

  return (
    <div className={cn('divide-y divide-white/[0.06]', className)}>
      {gates.map((gate, i) => (
        <div key={gate.title} className="grid grid-cols-[22px_1fr_auto] items-start gap-3 py-3">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border text-[10px]',
              gate.done
                ? 'border-emerald bg-emerald text-black'
                : i === nextIndex
                  ? 'border-amber text-amber'
                  : 'border-white/[0.1] text-ink-dim',
            )}
          >
            {gate.done ? '✓' : ''}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink">{gate.title}</div>
            <div className="mt-0.5 break-words font-mono text-[10.5px] text-ink-dim">
              {gate.detail}
            </div>
          </div>
          <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim">
            {gate.actor}
          </span>
        </div>
      ))}
    </div>
  );
}
