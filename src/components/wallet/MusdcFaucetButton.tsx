import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { captureProductEvent } from '@/lib/telemetry';
import { claimMockUsdc } from '@/services/chain/musdcFaucet';
import { cn } from '@/lib/cn';

type FaucetState = 'idle' | 'pending' | 'success' | 'error';

interface MusdcFaucetButtonProps {
  compact?: boolean;
  className?: string;
}

export function MusdcFaucetButton({ compact, className }: MusdcFaucetButtonProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<FaucetState>('idle');
  const [message, setMessage] = useState('');
  const [hash, setHash] = useState('');

  useEffect(() => {
    if (state !== 'success') return;
    const timer = window.setTimeout(() => setState('idle'), 8_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function claim() {
    setState('pending');
    setMessage('');
    captureProductEvent('transaction_started', { flow: 'musdc_faucet' });
    try {
      const result = await claimMockUsdc();
      setHash(result.hash);
      setState('success');
      setMessage('10,000 mUSDC added');
      captureProductEvent('transaction_confirmed', {
        flow: 'musdc_faucet',
        result: 'success',
      });
      await queryClient.invalidateQueries();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'The faucet transaction failed.');
      captureProductEvent('transaction_failed', { flow: 'musdc_faucet', result: 'error' });
    }
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => void claim()}
        disabled={state === 'pending'}
        className={cn(
          'group dc-btn-anim flex h-10 items-center justify-center gap-2 rounded-[11px] border px-3 font-semibold',
          'border-atelier/30 bg-atelier/[0.075] text-[11.5px] text-ink hover:border-atelier/50 hover:bg-atelier/[0.12]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier/65 disabled:pointer-events-none disabled:opacity-55',
          compact && 'w-10 px-0 sm:w-auto sm:px-3',
        )}
        aria-label="Mint 10,000 test mUSDC"
        title="Sepolia test token — no monetary value"
      >
        <FaucetGlyph active={state === 'pending'} />
        <span className={cn(compact && 'hidden sm:inline')}>
          {state === 'pending' ? 'Minting…' : state === 'success' ? '10k added' : 'Get 10k mUSDC'}
        </span>
      </button>

      {state !== 'idle' && state !== 'pending' && (
        <div
          className={cn(
            'absolute right-0 top-[calc(100%+9px)] z-50 w-[min(290px,calc(100vw-24px))] animate-dcslideup rounded-[13px] border px-3.5 py-3 shadow-[0_18px_55px_rgba(0,0,0,.5)]',
            state === 'success'
              ? 'border-emerald/25 bg-elevated text-emerald'
              : 'border-ruby/25 bg-elevated text-ruby',
          )}
          role={state === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                state === 'success' ? 'bg-emerald' : 'bg-ruby',
              )}
            />
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold">{message}</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-dim">
                {state === 'success'
                  ? 'Test funds are ready on Sepolia.'
                  : 'No test tokens were minted.'}
              </p>
              {state === 'success' && hash && (
                <a
                  href={explorerTxUrl(hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex font-mono text-[10px] text-ink-muted hover:text-ink"
                >
                  View {shortenAddress(hash, 6)} ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FaucetGlyph({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'relative grid h-[17px] w-[17px] shrink-0 rotate-45 place-items-center rounded-[4px] border border-atelier/55 bg-atelier/[0.12] transition-transform',
        active && 'animate-pulse',
      )}
      aria-hidden
    >
      <span className="-rotate-45 font-mono text-[10px] font-medium leading-none text-atelier">
        +
      </span>
    </span>
  );
}
