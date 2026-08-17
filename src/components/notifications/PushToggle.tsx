import { useEffect, useState } from 'react';
import {
  disablePush,
  enablePush,
  pushState,
  pushSupported,
  type PushState,
} from '@/services/offchain/push';

/**
 * Turns browser notifications on for this device.
 *
 * Lives inside the notification panel rather than in settings, because the
 * moment someone opens their notifications is the moment the offer is legible:
 * they are already looking at the thing they would otherwise have missed.
 *
 * Shows nothing at all when the browser cannot do push, or when no application
 * key is configured. An control that cannot work is worse than no control.
 */
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pushState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pushSupported() || state === null || state === 'unsupported' || state === 'unconfigured') {
    return null;
  }

  if (state === 'denied') {
    return (
      <p className="border-b border-line/[0.06] px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
        Browser notifications are blocked for this site. Re-enable them in your browser’s site
        settings to be told when something needs you.
      </p>
    );
  }

  const subscribed = state === 'subscribed';

  return (
    <div className="border-b border-line/[0.06]">
      {failure && (
        <p role="alert" className="px-4 pt-2.5 text-[11.5px] leading-relaxed text-ruby">
          {failure}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="text-[11.5px] leading-snug text-ink-muted">
          {subscribed
            ? 'Notifications are on for this device.'
            : 'Get notified when an offer arrives or a deadline is near.'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailure(null);
            try {
              // Both calls are driven from this click on purpose: browsers only
              // allow the permission prompt in response to a gesture.
              setState(await (subscribed ? disablePush() : enablePush()));
            } catch (error) {
              // Whether the server holds this device's keys is what decides
              // whether push works at all, so a failure there has to be said
              // rather than swallowed into a panel reading "Notifications are on".
              setFailure(
                error instanceof Error ? error.message : 'Could not change notifications.',
              );
              setState(await pushState());
            } finally {
              setBusy(false);
            }
          }}
          className="shrink-0 rounded-[4px] border border-line/[0.12] px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-line/[0.04] disabled:opacity-50"
        >
          {busy ? '…' : subscribed ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}
