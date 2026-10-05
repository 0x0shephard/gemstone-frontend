import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/cn';

export type LifecycleStageState = 'complete' | 'current' | 'pending' | 'attention';

export interface LifecycleStage {
  key: string;
  label: string;
  state: LifecycleStageState;
  detail?: string;
  occurredAt?: string;
}

export interface LifecycleEvent {
  id: string;
  label: string;
  detail?: string;
  occurredAt: string;
  actorLabel?: string;
  supersededBy?: string | null;
  correctionOf?: string | null;
}

const stageTone: Record<LifecycleStageState, StatusTone> = {
  complete: 'success',
  current: 'info',
  pending: 'neutral',
  attention: 'warning',
};

const stageLabel: Record<LifecycleStageState, string> = {
  complete: 'Complete',
  current: 'In progress',
  pending: 'Pending',
  attention: 'Needs attention',
};

function when(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Canonical lifecycle presentation shared by staff and owner views.
 *
 * The event list is append-only. Corrected records stay visible and point to
 * their replacement instead of disappearing, so the UI preserves the same
 * audit story as the server projection.
 */
export function LifecycleTracker({
  title = 'Lifecycle',
  stages,
  events,
  className,
}: {
  title?: string;
  stages: LifecycleStage[];
  events: LifecycleEvent[];
  className?: string;
}) {
  return (
    <section className={cn('space-y-5', className)} aria-label={title}>
      <div>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {stages.map((stage) => (
            <li
              key={stage.key}
              className={cn(
                'rounded-[4px] border px-3.5 py-3',
                stage.state === 'current' && 'border-sapphire/30 bg-sapphire/[0.05]',
                stage.state === 'complete' && 'border-emerald/25 bg-emerald/[0.04]',
                stage.state === 'attention' && 'border-amber/30 bg-amber/[0.05]',
                stage.state === 'pending' && 'border-line/[0.08] bg-line/[0.02]',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-ink">{stage.label}</span>
                <StatusBadge
                  tone={stageTone[stage.state]}
                  className="shrink-0 px-2 py-1 text-[10px]"
                >
                  {stageLabel[stage.state]}
                </StatusBadge>
              </div>
              {stage.detail && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">{stage.detail}</p>
              )}
              {stage.occurredAt && (
                <time
                  dateTime={stage.occurredAt}
                  className="mt-2 block font-mono text-[10px] text-ink-dim"
                >
                  {when(stage.occurredAt)}
                </time>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Audit history
        </h4>
        {events.length === 0 ? (
          <p className="mt-2 rounded-[4px] border border-dashed border-line/[0.1] px-4 py-6 text-[12px] text-ink-dim">
            No lifecycle events have been recorded yet.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {events.map((event) => {
              const corrected = Boolean(event.supersededBy);
              return (
                <li
                  key={event.id}
                  className={cn(
                    'rounded-[4px] border border-line/[0.07] bg-line/[0.018] px-3.5 py-3',
                    corrected && 'border-amber/20 bg-amber/[0.035]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[12.5px] font-medium text-ink">{event.label}</p>
                      {event.detail && (
                        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                          {event.detail}
                        </p>
                      )}
                    </div>
                    {corrected && <StatusBadge tone="warning">Corrected</StatusBadge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-ink-dim">
                    <time dateTime={event.occurredAt}>{when(event.occurredAt)}</time>
                    {event.actorLabel && <span>{event.actorLabel}</span>}
                    {event.correctionOf && <span>Corrects {event.correctionOf}</span>}
                    {event.supersededBy && <span>Superseded by {event.supersededBy}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
