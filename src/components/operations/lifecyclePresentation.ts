import type {
  RedemptionTracker,
  SellerWorkflowView,
  WorkflowEventView,
} from '@/services/offchain/operations';
import type { LifecycleEvent, LifecycleStage } from './LifecycleTracker';

const sellerStages = [
  ['submitted', 'Seller submission'],
  ['appraised', 'Gem lab appraisal'],
  ['safe_wagon_islamabad', 'Safe Wagon Islamabad'],
  ['turkish_airlines', 'Turkish Airlines'],
  ['turkish_house', 'Turkish House'],
  ['safe_wagon_turkey', 'Safe Wagon Turkey'],
  ['bank_received', 'Vault custodian receipt'],
  ['activation_started', 'Protocol activation'],
  ['registered', 'Gem registered'],
  ['listed', 'Listing active'],
] as const;

function recordedStates(events: WorkflowEventView[]) {
  return new Set(events.map((event) => event.toState));
}

function stageList(
  definitions: ReadonlyArray<readonly [string, string]>,
  currentState: string,
  events: WorkflowEventView[],
  legacyBaseline: boolean,
): LifecycleStage[] {
  const explicit = recordedStates(events);
  const currentIndex = definitions.findIndex(([key]) => key === currentState);

  return definitions.map(([key, label], index) => {
    const event = [...events].reverse().find((entry) => entry.toState === key);
    if (event) {
      return {
        key,
        label,
        state: key === currentState ? ('current' as const) : ('complete' as const),
        occurredAt: event.occurredAt,
      };
    }
    if (key === currentState) {
      return {
        key,
        label,
        state: 'current' as const,
        detail: legacyBaseline
          ? 'Legacy baseline. No post-migration evidence event is asserted.'
          : undefined,
      };
    }
    return {
      key,
      label,
      state:
        currentIndex >= 0 && index < currentIndex && explicit.has(key)
          ? ('complete' as const)
          : ('pending' as const),
    };
  });
}

/** The gem lab's refusal, from the `gem_rejected` workflow event (#15). */
function rejectionOf(workflow: SellerWorkflowView): WorkflowEventView | undefined {
  return [...workflow.events]
    .reverse()
    .find((event) => event.type === 'gem_rejected' || event.toState === 'rejected');
}

function rejectionReason(event: WorkflowEventView | undefined): string | undefined {
  const reason = event?.payload?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
}

const EVENT_LABEL: Record<string, string> = {
  gem_rejected: 'Rejected by gem lab',
};

export function eventPresentation(events: WorkflowEventView[]): LifecycleEvent[] {
  const correctionTargets = new Map(
    events
      .filter((event) => event.supersedesEventId)
      .map((event) => [event.supersedesEventId as string, event.id]),
  );
  return [...events]
    .sort((left, right) => right.sequence - left.sequence)
    .map((event) => ({
      id: event.id,
      label: EVENT_LABEL[event.type] ?? event.type.replaceAll('_', ' '),
      detail:
        event.correctionReason ??
        (event.type === 'gem_rejected' ? rejectionReason(event) : undefined),
      occurredAt: event.occurredAt,
      actorLabel: event.actorLabel,
      correctionOf: event.supersedesEventId ?? undefined,
      supersededBy: correctionTargets.get(event.id),
    }));
}

export function redemptionLifecycleStages(workflow: RedemptionTracker): LifecycleStage[] {
  return workflow.steps.map((step) => ({
    key: step.key,
    label: step.label,
    state:
      step.state === 'upcoming' ? 'pending' : step.state === 'blocked' ? 'attention' : step.state,
    occurredAt: step.occurredAt,
  }));
}

export function sellerLifecycleStages(workflow: SellerWorkflowView): LifecycleStage[] {
  const rejection = rejectionOf(workflow);
  if (workflow.state === 'rejected' || rejection) {
    /*
     * A rejected stone stops at submission: nothing after it will happen, so
     * the remaining stages are not shown as pending work. The terminal stage
     * carries the lab's reason.
     */
    return [
      {
        key: 'submitted',
        label: 'Seller submission',
        state: 'complete',
        occurredAt: workflow.events.find((event) => event.toState === 'submitted')?.occurredAt,
      },
      {
        key: 'rejected',
        label: 'Rejected by gem lab',
        state: 'attention',
        occurredAt: rejection?.occurredAt,
        detail: rejectionReason(rejection) ?? 'The gem lab declined this stone.',
      },
    ];
  }
  const stages = stageList(sellerStages, workflow.state, workflow.events, workflow.legacyBaseline);
  const latest = (match: (event: WorkflowEventView) => boolean) =>
    [...workflow.events].reverse().find(match);
  const appraisal = latest((event) => event.toState === 'appraised');
  const bankReceipt = latest(
    (event) => event.type === 'bank_receipt_recorded' || event.toState === 'bank_received',
  );
  // Appended only after activation has registered, verified and listed the gem on-chain.
  const activation = latest(
    (event) => event.type === 'seller_activated' || event.toState === 'activated',
  );
  const receiptBacked = new Set([
    'safe_wagon_islamabad',
    'turkish_airlines',
    'turkish_house',
    'safe_wagon_turkey',
  ]);
  const activationBacked = new Set(['activation_started', 'registered', 'listed']);
  return stages.map((stage) => {
    if (stage.key === 'submitted' && appraisal && stage.state === 'pending') {
      return {
        ...stage,
        state: 'complete' as const,
        detail: 'Implied by the gem lab appraisal of this submission.',
      };
    }
    if (bankReceipt && receiptBacked.has(stage.key)) {
      return {
        ...stage,
        state: 'complete' as const,
        occurredAt: bankReceipt.occurredAt,
        detail: 'Confirmed retroactively by the authoritative vault custodian receipt.',
      };
    }
    if (activation && activationBacked.has(stage.key) && stage.state !== 'complete') {
      return {
        ...stage,
        state: 'complete' as const,
        occurredAt: stage.occurredAt ?? activation.occurredAt,
        detail: 'Confirmed by the completed protocol activation.',
      };
    }
    return stage;
  });
}
