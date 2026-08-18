import { useEffect, useRef, useState } from 'react';
import type { TxResult } from '@/services/types';
import {
  BroadcastPendingError,
  WalletResponseTimeoutError,
  setStepGate,
  type StepPrompt,
  type TransactionStep,
} from '@/services/chain/txSteps';
import { Button, type ButtonVariant, type ButtonSize } from '@/components/ui/Button';
import { explorerTxUrl } from '@/config/chains';
import { shortenAddress } from '@/lib/format';
import { captureProductEvent } from '@/lib/telemetry';
import { useQueryClient } from '@tanstack/react-query';

/**
 * `awaiting-gesture` is the state this component exists for on a phone.
 *
 * Each wallet request needs its own tap, so the request is built while the
 * browser is demonstrably in front. Chaining them automatically meant the second
 * was created while the tab was backgrounded, and the wallet opened to nothing.
 *
 * `broadcast` is the other one that matters: something is on chain and its
 * outcome is unknown. It is deliberately terminal for this button — retrying
 * from here is how the same purchase gets paid for twice.
 */
type TxState =
  'idle' | 'awaiting-gesture' | 'pending' | 'success' | 'error' | 'broadcast' | 'unknown';

/**
 * What each stage is actually waiting on.
 *
 * On a phone the wallet stages hand control to another app entirely. A single
 * "Confirming…" across all of them is indistinguishable from a hang, which is
 * how a two-signature reserve top-up was reported: the label never changed
 * while the wallet prompt sat behind the browser.
 */
const STEP_LABEL: Record<TransactionStep, string> = {
  checking: 'Checking your wallet…',
  approving: 'Approve the allowance in your wallet…',
  'awaiting-signature': 'Confirm in your wallet…',
  confirming: 'Waiting for the network…',
};

interface TxButtonProps {
  /** The write action; return a TxResult to surface the hash + explorer link. */
  action: () => Promise<TxResult>;
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  disabled?: boolean;
  /**
   * Called when the user dismisses a *confirmed* transaction, not the moment it
   * confirms. Callers pass their modal's `onClose`; firing it automatically
   * closed the dialog in the same frame the confirmation appeared, so nobody
   * ever saw the hash or the explorer link.
   */
  onDone?: (result: TxResult) => void;
  /** Label for the dismissal button shown after success. */
  doneLabel?: string;
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
  doneLabel = 'Done',
  telemetryFlow = 'transaction',
}: TxButtonProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>('idle');
  const [step, setStep] = useState<TransactionStep>();
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<TxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<StepPrompt>();
  // Resolves the gate promise. A ref rather than state: the pipeline is awaiting
  // this exact function, and a re-render must not hand it a different one.
  const continueRef = useRef<(() => void) | undefined>(undefined);

  /*
   * Steps arrive as window events rather than through the action signature, so
   * every existing caller keeps working untouched — the pipeline announces, the
   * button listens.
   *
   * Attached unconditionally rather than only while pending. Gating on `state`
   * meant the listener was only bound after the `pending` render committed, but
   * the pipeline announces its first step synchronously inside `action()` —
   * before React has flushed — so that step was reliably emitted into nothing
   * and never displayed. `run()` clears `step` before starting, and only a
   * pending button renders it, so a stray event cannot show a stale stage.
   */
  useEffect(() => {
    const onStep = (event: Event) =>
      setStep((event as CustomEvent<{ step: TransactionStep }>).detail.step);
    window.addEventListener('dc:transaction-step', onStep);
    return () => window.removeEventListener('dc:transaction-step', onStep);
  }, []);

  async function run() {
    setState('pending');
    setStep(undefined);
    setError(null);
    captureProductEvent('transaction_started', { flow: telemetryFlow });

    /*
     * The pipeline pauses here before every wallet request and waits for a tap.
     *
     * The gate is a single module-level slot, cleared in `finally`. Two writes
     * running at once would therefore contend — which is a limitation rather
     * than a guard, and an acceptable one: a wallet handles one request at a
     * time regardless, and every screen here disables its button while a
     * transaction is in flight.
     */
    setStepGate(
      (nextPrompt) =>
        new Promise<void>((resolve) => {
          setPrompt(nextPrompt);
          setState('awaiting-gesture');
          continueRef.current = () => {
            setState('pending');
            resolve();
          };
        }),
    );

    try {
      const res = await action();
      setHash(res.hash);
      setResult(res);
      setState('success');
      captureProductEvent('transaction_confirmed', { flow: telemetryFlow, result: 'success' });
      await queryClient.invalidateQueries();
    } catch (e) {
      if (e instanceof BroadcastPendingError) {
        // Sent, outcome unknown. No retry is offered: the hash is the useful
        // thing, and a second attempt would duplicate work already in flight.
        setHash(e.hash);
        setError(e.message);
        setState('broadcast');
        captureProductEvent('transaction_failed', { flow: telemetryFlow, result: 'broadcast' });
      } else if (e instanceof WalletResponseTimeoutError) {
        setError(e.message);
        setState('unknown');
        captureProductEvent('transaction_failed', {
          flow: telemetryFlow,
          result: 'wallet_timeout',
        });
      } else {
        setError(e instanceof Error ? e.message : 'Transaction failed');
        setState('error');
        captureProductEvent('transaction_failed', { flow: telemetryFlow, result: 'error' });
      }
      // A wallet can broadcast successfully even if its relay returns an error.
      // Refreshing chain-backed data removes work that actually completed.
      void queryClient.invalidateQueries();
    } finally {
      setStepGate(undefined);
      continueRef.current = undefined;
    }
  }

  return (
    <div className={block ? 'w-full space-y-2.5' : 'space-y-2.5'}>
      {/*
        Withdrawn entirely once confirmed. Leaving it mounted only re-enabled it,
        so a second click would have run the same purchase or listing again
        against a wallet that had already paid.
      */}
      {state !== 'success' &&
        state !== 'broadcast' &&
        state !== 'unknown' &&
        state !== 'awaiting-gesture' && (
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
                {step ? STEP_LABEL[step] : pendingLabel}
              </>
            ) : (
              children
            )}
          </Button>
        )}

      {/*
        One tap per wallet request. The wallet is opened from this handler, so
        the request is built while the browser is in the foreground — which is
        the whole reason a phone stopped being shown an empty wallet.
      */}
      {state === 'awaiting-gesture' && prompt && (
        <div className="space-y-2">
          <Button
            variant={variant}
            size={size}
            block={block}
            onClick={() => continueRef.current?.()}
          >
            {prompt.label}
            {prompt.total > 1 ? ` · step ${prompt.index + 1} of ${prompt.total}` : ''}
          </Button>
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            {prompt.total > 1
              ? 'Your wallet opens when you tap. Come back here afterwards — the next step waits for you rather than opening on its own.'
              : 'Your wallet opens when you tap.'}
          </p>
        </div>
      )}

      <div aria-live="polite">
        {state === 'pending' && (
          <div className="flex items-start gap-2.5 rounded-[4px] border border-atelier/20 bg-atelier/[0.055] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-muted">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-atelier" />
            {step === 'approving' || step === 'awaiting-signature'
              ? 'Open your wallet app if it did not come to the front. A payment in mUSDC needs two signatures — one to approve the allowance, one to send.'
              : 'The app will simulate the action, request any approval and wait for confirmation.'}
          </div>
        )}
        {state === 'success' && hash && (
          <div className="space-y-2.5">
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
            {onDone && (
              <Button variant="secondary" size={size} block={block} onClick={() => onDone(result!)}>
                {doneLabel}
              </Button>
            )}
          </div>
        )}
      </div>
      {state === 'broadcast' && hash && (
        <div
          role="alert"
          className="space-y-2 rounded-[4px] border border-atelier/25 bg-atelier/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink"
        >
          <p>{error}</p>
          <a
            href={explorerTxUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="block font-mono text-[11.5px] underline underline-offset-2"
          >
            {shortenAddress(hash, 6)} ↗
          </a>
        </div>
      )}
      {(state === 'error' || state === 'unknown') && (
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
      // Drawn in currentColor so it stays legible on every button variant and in
      // both colour schemes; the transparent head gives the arc its rotation.
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-current border-t-transparent opacity-70"
      aria-hidden
    />
  );
}
