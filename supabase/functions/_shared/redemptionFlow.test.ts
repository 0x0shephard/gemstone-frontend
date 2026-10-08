import { describe, expect, it } from 'vitest';
import { assertRedemptionTransition, redemptionSteps } from './redemptionFlow';

const states = (
  method: 'pickup' | 'insured_delivery',
  state: Parameters<typeof redemptionSteps>[1],
) => redemptionSteps(method, state).map((step) => step.state);

describe('redemption flow', () => {
  it('walks the six steps from request to burn', () => {
    const path = [
      'onchain_requested',
      'accepted',
      'custodian_collected',
      'custodian_dispatched',
      'arrived',
      'proof_approved',
      'owner_authorized',
      'chain_burned',
    ] as const;
    for (let index = 1; index < path.length; index++) {
      expect(() => assertRedemptionTransition(path[index - 1], path[index])).not.toThrow();
    }
    expect(states('pickup', 'onchain_requested')).toEqual([
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(states('pickup', 'proof_approved')).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
      'current',
      'upcoming',
    ]);
    expect(states('pickup', 'chain_burned').every((state) => state === 'complete')).toBe(true);
  });

  it('requires Digital Carat acceptance before the vault collects', () => {
    expect(() => assertRedemptionTransition('onchain_requested', 'custodian_collected')).toThrow();
    expect(() => assertRedemptionTransition('accepted', 'custodian_collected')).not.toThrow();
  });

  it('lets the holder cancel only before the vault starts fulfilment', () => {
    expect(() => assertRedemptionTransition('onchain_requested', 'cancelled')).not.toThrow();
    expect(() => assertRedemptionTransition('accepted', 'cancelled')).not.toThrow();
    expect(() => assertRedemptionTransition('custodian_collected', 'cancelled')).toThrow();
  });

  it('finishes rows left in the retired bank and proof-review states', () => {
    expect(() => assertRedemptionTransition('bank_received', 'arrived')).not.toThrow();
    expect(() => assertRedemptionTransition('pickup_handover_recorded', 'arrived')).not.toThrow();
    expect(() =>
      assertRedemptionTransition('delivery_proof_submitted', 'proof_approved'),
    ).not.toThrow();
    expect(states('pickup', 'bank_received')).toEqual([
      'complete',
      'complete',
      'complete',
      'current',
      'upcoming',
      'upcoming',
    ]);
  });

  it('names the arrival step after the fulfilment route', () => {
    expect(redemptionSteps('pickup', 'accepted')[3].label).toBe(
      'Delivery custodian delivered it to the pickup point',
    );
    expect(redemptionSteps('insured_delivery', 'accepted')[3].label).toBe(
      'Delivery custodian delivered it to the delivery address',
    );
  });

  it('blocks every step of a cancelled request', () => {
    expect(states('pickup', 'cancelled').every((state) => state === 'blocked')).toBe(true);
  });
});
