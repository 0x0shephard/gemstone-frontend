import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), refetch: vi.fn() }));
vi.mock('@/hooks/useOperationsAccess', () => ({ useOperationsAccess: mocks.access }));

import { OperationsAccessGate } from './OperationsAccessGate';

describe('OperationsAccessGate', () => {
  beforeEach(() => {
    mocks.refetch.mockReset();
  });

  it('fails closed without disclosing a staff route when capability is absent', () => {
    mocks.access.mockReturnValue({
      user: { id: 'user' },
      authLoading: false,
      isLoading: false,
      isFetching: false,
      isError: false,
      data: null,
      has: () => false,
      refetch: mocks.refetch,
    });
    render(
      <OperationsAccessGate capability="bank.receive">
        <p>Secret bank queue</p>
      </OperationsAccessGate>,
    );
    expect(screen.queryByText('Secret bank queue')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  it('distinguishes a permission service failure from a denial and permits retry', () => {
    mocks.access.mockReturnValue({
      user: { id: 'user' },
      authLoading: false,
      isLoading: false,
      isFetching: false,
      isError: true,
      data: undefined,
      has: () => false,
      refetch: mocks.refetch,
    });
    render(
      <OperationsAccessGate capability="bank.receive">
        <p>Secret bank queue</p>
      </OperationsAccessGate>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('permissions service did not respond');
    fireEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
