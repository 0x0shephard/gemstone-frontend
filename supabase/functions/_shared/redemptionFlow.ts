/**
 * The redemption lifecycle as Digital Carat runs it, kept free of Deno and npm
 * imports so the edge function and the unit tests share one definition.
 *
 * The holder sees six steps:
 *   1. On-chain request — Digital Carat accepts it.
 *   2. Custodian collected — the custodian vault confirms receipt of the request.
 *   3. Custodian dispatched — the vault sends the stone out.
 *   4. Arrived — at the pickup point, or in hand at the delivery address.
 *   5. Handed to customer — the holder confirms with their emailed code.
 *   6. Token burned.
 *
 * The internal states are finer than that: `arrived` is recorded before the
 * server approves the fulfillment proof on-chain and emails the code, and
 * `proof_approved` is the moment the code exists. Rows created before this
 * flow may still sit in the bank / proof-review states; they are mapped onto
 * the same six steps and finish through the new actions.
 */
export type RedemptionLifecycleState =
  | 'onchain_requested'
  | 'accepted'
  | 'custodian_collected'
  | 'custodian_dispatched'
  | 'arrived'
  | 'proof_approved'
  | 'owner_authorized'
  | 'chain_burned'
  | 'cancelled'
  // Pre-vault-flow states, kept so in-flight rows can still finish.
  | 'bank_received'
  | 'pickup_handover_recorded'
  | 'pickup_proof_submitted'
  | 'delivery_proof_submitted';

export type FulfillmentMethod = 'pickup' | 'insured_delivery';

/** States from which the vault may still record the stone's arrival. */
export const ARRIVAL_FROM_STATES: readonly RedemptionLifecycleState[] = [
  'custodian_dispatched',
  'bank_received',
  'pickup_handover_recorded',
];

/**
 * States in which a fulfillment proof is already on-chain and only the
 * automatic approval (and the holder's code email) is outstanding.
 */
export const APPROVAL_PENDING_STATES: readonly RedemptionLifecycleState[] = [
  'arrived',
  'pickup_proof_submitted',
  'delivery_proof_submitted',
];

/** RedemptionManager lets the holder cancel only before fulfillment starts. */
export const OWNER_CANCELLABLE_STATES: readonly RedemptionLifecycleState[] = [
  'onchain_requested',
  'accepted',
];

const transitionGraph: Record<RedemptionLifecycleState, readonly RedemptionLifecycleState[]> = {
  onchain_requested: ['accepted', 'cancelled'],
  accepted: ['custodian_collected', 'cancelled'],
  custodian_collected: ['custodian_dispatched'],
  custodian_dispatched: ['arrived'],
  arrived: ['proof_approved'],
  proof_approved: ['owner_authorized'],
  owner_authorized: ['chain_burned'],
  chain_burned: [],
  cancelled: [],
  bank_received: ['arrived'],
  pickup_handover_recorded: ['arrived'],
  pickup_proof_submitted: ['proof_approved'],
  delivery_proof_submitted: ['proof_approved'],
};

export function assertRedemptionTransition(
  from: RedemptionLifecycleState,
  to: RedemptionLifecycleState,
): void {
  if (!transitionGraph[from]?.includes(to)) throw new Error(`Cannot move from ${from} to ${to}`);
}

export type RedemptionStepKey =
  'accepted' | 'collected' | 'dispatched' | 'arrived' | 'handed_over' | 'burned';

interface StepDefinition {
  key: RedemptionStepKey;
  label: (method: FulfillmentMethod) => string;
  /** The state recorded when this step completes; used for its timestamp. */
  completedBy: RedemptionLifecycleState;
}

const STEPS: readonly StepDefinition[] = [
  {
    key: 'accepted',
    label: () => 'On-chain request accepted by Digital Carat',
    completedBy: 'accepted',
  },
  {
    key: 'collected',
    label: () => 'Custodian vault confirmed the request',
    completedBy: 'custodian_collected',
  },
  {
    key: 'dispatched',
    label: () => 'Dispatched from the custodian vault',
    completedBy: 'custodian_dispatched',
  },
  {
    key: 'arrived',
    label: (method) =>
      method === 'pickup' ? 'Arrived at the pickup point' : 'Arrived at the delivery address',
    completedBy: 'arrived',
  },
  {
    key: 'handed_over',
    label: () => 'Handed to the customer and confirmed with their code',
    completedBy: 'owner_authorized',
  },
  { key: 'burned', label: () => 'Token burned', completedBy: 'chain_burned' },
];

/** How many of the six steps a state has completed. */
function completedSteps(state: RedemptionLifecycleState): number {
  switch (state) {
    case 'onchain_requested':
    case 'cancelled':
      return 0;
    case 'accepted':
      return 1;
    case 'custodian_collected':
      return 2;
    case 'custodian_dispatched':
    case 'bank_received':
    case 'pickup_handover_recorded':
      return 3;
    case 'arrived':
    case 'pickup_proof_submitted':
    case 'delivery_proof_submitted':
    case 'proof_approved':
      return 4;
    case 'owner_authorized':
      return 5;
    case 'chain_burned':
      return 6;
  }
}

export interface RedemptionStepView {
  key: RedemptionStepKey;
  label: string;
  state: 'complete' | 'current' | 'upcoming' | 'blocked';
  completedBy: RedemptionLifecycleState;
}

export function redemptionSteps(
  method: FulfillmentMethod,
  state: RedemptionLifecycleState,
): RedemptionStepView[] {
  const done = completedSteps(state);
  return STEPS.map((step, index) => ({
    key: step.key,
    label: step.label(method),
    completedBy: step.completedBy,
    state:
      state === 'cancelled'
        ? 'blocked'
        : index < done
          ? 'complete'
          : index === done
            ? 'current'
            : 'upcoming',
  }));
}
