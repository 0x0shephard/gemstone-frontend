import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { zeroAddress, type Address } from 'viem';

const mocks = vi.hoisted(() => ({
  claimReserveCredit: vi.fn(async () => ({
    hash: `0x${'1'.repeat(64)}` as const,
    status: 'success' as const,
  })),
}));

vi.mock('@/services', () => ({
  dataService: { claimReserveCredit: mocks.claimReserveCredit },
}));

vi.mock('@/components/tx/TxButton', () => ({
  TxButton: ({
    action,
    children,
    disabled,
  }: {
    action: () => Promise<unknown>;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => void action()}>
      {children}
    </button>
  ),
}));

import { ReserveCreditsCard } from './ProfilePage';

describe('reserve-credit holder flow', () => {
  it('validates and submits an alternate recipient chosen by the credited holder', async () => {
    const beneficiary = '0x1111111111111111111111111111111111111111' as Address;
    const alternateRecipient = '0x2222222222222222222222222222222222222222' as Address;
    render(
      <ReserveCreditsCard
        beneficiary={beneficiary}
        credits={[
          {
            paymentAsset: zeroAddress,
            symbol: 'ETH',
            amount: 250000000000000000n,
            amountFmt: '0.25 ETH',
          },
        ]}
        onConfirmed={() => undefined}
      />,
    );

    const recipient = screen.getByLabelText('Recipient wallet');
    expect(recipient).toHaveValue(beneficiary);

    fireEvent.change(recipient, { target: { value: 'not-an-address' } });
    expect(screen.getByRole('alert')).toHaveTextContent('valid EVM wallet address');
    expect(screen.getByRole('button', { name: 'Claim ETH' })).toBeDisabled();

    fireEvent.change(recipient, { target: { value: alternateRecipient } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim ETH' }));

    await waitFor(() =>
      expect(mocks.claimReserveCredit).toHaveBeenCalledWith({
        paymentAsset: zeroAddress,
        recipient: alternateRecipient,
      }),
    );
  });
});
