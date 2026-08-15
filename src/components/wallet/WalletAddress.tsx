import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { cn } from '@/lib/cn';

/**
 * A wallet address you can actually copy.
 *
 * Everywhere else the app renders `shortenAddress`, which is right for a table
 * cell and useless for the one thing people need most: sending the address to
 * somebody so they can transfer a token to it. A truncated address cannot be
 * selected, cannot be copied, and cannot be typed back in from memory — so a
 * new holder had no way to receive anything.
 */
export function WalletAddress({
  address,
  label,
  className,
}: {
  address: Address;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Revert the confirmation on its own; a button stuck on "Copied" stops being
  // feedback and starts being a label.
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2200);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setState('copied');
    } catch {
      // Clipboard access can be refused — an insecure context, or a browser
      // that wants a fresher user gesture. The address is on screen in full,
      // so selecting it by hand still works.
      setState('failed');
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          {label}
        </span>
      )}
      <div className="flex items-start gap-2">
        {/*
          `break-all` and `select-all`: the full address is shown so it can be
          read aloud or selected manually when the clipboard is unavailable.
        */}
        <code className="min-w-0 flex-1 select-all break-all font-mono text-[11.5px] leading-relaxed text-ink">
          {address}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy wallet address ${address}`}
          className="dc-btn-anim shrink-0 rounded-[4px] border border-line/[0.14] px-2.5 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:border-line/[0.24] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier/70"
        >
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Address copied to clipboard' : ''}
      </span>
      {state === 'failed' && (
        <span className="text-[11px] text-ink-dim">
          Copying was blocked. Select the address above and copy it manually.
        </span>
      )}
    </div>
  );
}
