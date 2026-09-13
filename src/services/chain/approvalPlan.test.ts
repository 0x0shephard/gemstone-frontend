import { describe, expect, it } from 'vitest';
import { paymentApprovalAmounts } from './approvalPlan';

describe('payment approval planning', () => {
  it('does not ask for a wallet request when allowance already covers the payment', () => {
    expect(paymentApprovalAmounts(100n, 100n)).toEqual([]);
  });

  it('uses one approval when no allowance exists', () => {
    expect(paymentApprovalAmounts(0n, 100n)).toEqual([100n]);
  });

  it('resets a residual allowance before setting a new USDT-compatible allowance', () => {
    expect(paymentApprovalAmounts(1n, 100n)).toEqual([0n, 100n]);
  });
});
