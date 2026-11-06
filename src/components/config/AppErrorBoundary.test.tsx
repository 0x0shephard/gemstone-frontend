import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('@/lib/telemetry', () => ({ captureError }));

function Broken(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  it('shows the failure and reports it', () => {
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('unexpected error');
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render failed' }),
    );
    console_.mockRestore();
  });

  it('renders children when nothing fails', () => {
    render(
      <AppErrorBoundary>
        <p>Stones</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Stones')).toBeInTheDocument();
  });
});
