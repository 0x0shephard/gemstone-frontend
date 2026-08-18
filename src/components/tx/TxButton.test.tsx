import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TxButton } from './TxButton';
import type { TxResult } from '@/services/types';
import { WalletResponseTimeoutError, awaitGesture } from '@/services/chain/txSteps';

vi.mock('@/lib/telemetry', () => ({ captureProductEvent: () => {} }));
vi.mock('@/config/chains', () => ({
  explorerTxUrl: (hash: string) => `https://example/tx/${hash}`,
}));

const RESULT: TxResult = { hash: '0xabc123def4567890', status: 'success' };

function renderButton(props: Partial<React.ComponentProps<typeof TxButton>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TxButton action={async () => RESULT} {...props}>
        Pay $8,352
      </TxButton>
    </QueryClientProvider>,
  );
}

describe('TxButton', () => {
  it('shows the confirmation with an explorer link after success', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: /pay/i }));
    const link = await screen.findByRole('link');
    expect(link).toHaveTextContent(/transaction confirmed/i);
    expect(link).toHaveAttribute('href', 'https://example/tx/0xabc123def4567890');
  });

  it('withdraws the action button once confirmed, so the payment cannot repeat', async () => {
    // The button previously re-enabled after success, and every modal closed
    // itself on confirmation — so this was only survivable by accident.
    const action = vi.fn(async () => RESULT);
    renderButton({ action });
    await userEvent.click(screen.getByRole('button', { name: /pay/i }));
    await screen.findByRole('link');
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not fire onDone until the user dismisses', async () => {
    // Callers pass their modal's onClose. Firing it on confirmation closed the
    // dialog in the same frame the confirmation appeared, so it was never seen.
    const onDone = vi.fn();
    renderButton({ onDone });
    await userEvent.click(screen.getByRole('button', { name: /pay/i }));
    await screen.findByRole('link');
    expect(onDone).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onDone).toHaveBeenCalledWith(RESULT);
  });

  it('surfaces a failure and leaves the action retryable', async () => {
    const action = vi.fn(async () => {
      throw new Error('Insufficient payment-asset balance.');
    });
    renderButton({ action });
    await userEvent.click(screen.getByRole('button', { name: /pay/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Insufficient payment-asset balance.'),
    );
    expect(screen.getByRole('button', { name: /pay/i })).toBeEnabled();
  });

  it('stops buffering without offering an unsafe retry when the wallet never replies', async () => {
    renderButton({
      action: async () => {
        throw new WalletResponseTimeoutError();
      },
    });
    await userEvent.click(screen.getByRole('button', { name: /pay/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/check metamask activity/i),
    );
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
  });

  it('requires a fresh tap before asking a phone wallet to switch networks', async () => {
    const action = vi.fn(async () => {
      await awaitGesture({
        index: 0,
        total: 1,
        label: 'Switch wallet to Sepolia',
        kind: 'network',
      });
      return RESULT;
    });
    renderButton({ action });

    await userEvent.click(screen.getByRole('button', { name: /pay/i }));
    const switchButton = await screen.findByRole('button', { name: 'Switch wallet to Sepolia' });
    expect(action).toHaveBeenCalledTimes(1);

    await userEvent.click(switchButton);
    await screen.findByRole('link');
  });
});
