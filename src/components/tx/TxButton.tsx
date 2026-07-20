import { useState } from 'react';
import type { TxResult } from '@/services/types';
import { Button, type ButtonVariant, type ButtonSize } from '@/components/ui/Button';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';

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
}

/**
 * Button that runs an on-chain (mocked) write and renders the full lifecycle:
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
}: TxButtonProps) {
  const [state, setState] = useState<TxState>('idle');
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState('pending');
    setError(null);
    try {
      const res = await action();
      setHash(res.hash);
      setState('success');
      onDone?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
      setState('error');
    }
  }

  return (
    <div className={block ? 'w-full space-y-2' : 'space-y-2'}>
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

      {state === 'success' && hash && (
        <a
          href={explorerTxUrl(hash)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[12px] text-emerald hover:underline"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
          Confirmed · {shortenAddress(hash, 6)} ↗
        </a>
      )}
      {state === 'error' && (
        <p className="text-[12px] text-ruby">{error ?? 'Transaction rejected.'}</p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-black/30 border-t-black/80"
      aria-hidden
    />
  );
}
