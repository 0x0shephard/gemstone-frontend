import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('wagmi', () => ({
  useAccount: () => ({
    status: 'connected',
    connector: { name: 'MetaMask' },
    chainId: 1,
    address: '0x00000000000000000000000000000000000000aa',
  }),
}));

import { DiagnosticsPanel } from './DiagnosticsPanel';
import { recordDiagnostic } from '@/lib/diagnostics';

describe('DiagnosticsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('stays hidden unless debug mode is on', () => {
    render(<DiagnosticsPanel />);
    expect(screen.queryByRole('button', { name: /Diagnostics/ })).not.toBeInTheDocument();
  });

  it('shows the wallet state and the recorded trail once enabled', async () => {
    window.history.replaceState(null, '', '/swaps?debug=1');
    recordDiagnostic('page', 'visibility hidden');
    render(<DiagnosticsPanel />);

    await userEvent.click(screen.getByRole('button', { name: /Diagnostics/ }));

    expect(screen.getByText(/wallet 1 · app/)).toHaveClass('text-ruby');
    expect(screen.getByText(/visibility hidden/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeInTheDocument();
  });
});
