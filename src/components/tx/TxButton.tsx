import { useState } from 'react';
import type { TxResult } from '@/services/types';
import { Button, type ButtonVariant, type ButtonSize } from '@/components/ui/Button';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { captureProductEvent } from '@/lib/telemetry';
import { useQueryClient } from '@tanstack/react-query';

type TxState = 'idle' | 'pending' | 'success' | 'error';

interface TxButtonProps {
  /** The write action; return a TxResult to surface the hash + explorer link. */
  action: () => Promise<TxResult>;
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  disabled?: boolean;
  onDone?: (result: TxResult) => void;
  telemetryFlow?: string;
}

/**
 * Button that runs a data-adapter write and renders the full lifecycle:
 * idle → pending (spinner) → success (hash + explorer link) or error.
 */
export function TxButton({
  action,
  children,
  pendingLabel = 'Confirming…',
  variant = 'primary',
  size = 'md',
  block,
  disabled,
  onDone,
  telemetryFlow = 'transaction',
}: TxButtonProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>('idle');
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState('pending');
    setError(null);
    captureProductEvent('transaction_started', { flow: telemetryFlow });
    try {
      const res = await action();
      setHash(res.hash);
      setState('success');
      captureProductEvent('transaction_confirmed', { flow: telemetryFlow, result: 'success' });
      await queryClient.invalidateQueries();
      onDone?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
      setState('error');
      captureProductEvent('transaction_failed', { flow: telemetryFlow, result: 'error' });
    }
  }

  return (
    <div className={block ? 'w-full space-y-2.5' : 'space-y-2.5'}>
      <Button
        variant={variant}
        size={size}
        block={block}
        disabled={disabled || state === 'pending'}
        onClick={run}
      >
        {state === 'pending' ? (
          <>
            <Spinner />
            {pendingLabel}
          </>
        ) : (
          children
        )}
      </Button>

      <div aria-live="polite">
        {state === 'pending' && (
          <div className="flex items-start gap-2.5 rounded-[4px] border border-atelier/20 bg-atelier/[0.055] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-muted">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-atelier" />
            Follow the wallet prompts. The app will simulate the action, request any approval and
            wait for confirmation.
          </div>
        )}
        {state === 'success' && hash && (
          <a
            href={explorerTxUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-[4px] border border-emerald/20 bg-emerald/[0.055] px-3 py-2.5 text-[11.5px] text-emerald"
          >
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              Transaction confirmed
            </span>
            <span className="font-mono">{shortenAddress(hash, 6)} ↗</span>
          </a>
        )}
      </div>
      {state === 'error' && (
        <p
          role="alert"
          className="rounded-[4px] border border-ruby/20 bg-ruby/[0.055] px-3 py-2.5 text-[11.5px] leading-relaxed text-ruby"
        >
          {error ?? 'Transaction rejected.'}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-black/25 border-t-black/80"
      aria-hidden
    />
  );
}
