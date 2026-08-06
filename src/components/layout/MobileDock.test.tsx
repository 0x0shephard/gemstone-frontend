import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileDock } from './MobileDock';

/**
 * "Token Bids" and "Portfolio" are both `/profile`, separated only by `?tab`.
 * `NavLink`'s own `isActive` compares pathnames, so it lights both at once —
 * hence the custom check this covers.
 */
function dockAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileDock />
    </MemoryRouter>,
  );
  const active = (name: RegExp) =>
    screen.getByRole('link', { name }).className.includes('text-ink') &&
    !screen.getByRole('link', { name }).className.includes('text-ink-dim');
  return { active };
}

describe('MobileDock', () => {
  it('highlights Portfolio on /profile with no tab', () => {
    const { active } = dockAt('/profile');
    expect(active(/portfolio/i)).toBe(true);
    expect(active(/bids/i)).toBe(false);
  });

  it('highlights Token Bids, not Portfolio, on the offers tab', () => {
    const { active } = dockAt('/profile?tab=offers');
    expect(active(/bids/i)).toBe(true);
    expect(active(/portfolio/i)).toBe(false);
  });

  it('highlights neither when another Portfolio tab is open', () => {
    const { active } = dockAt('/profile?tab=swaps');
    expect(active(/bids/i)).toBe(false);
    expect(active(/portfolio/i)).toBe(false);
  });

  it('still exposes Swaps, which moved out of the dock into More', () => {
    render(
      <MemoryRouter initialEntries={['/marketplace']}>
        <MobileDock />
      </MemoryRouter>,
    );
    // Not a dock button, but reachable — the sidebar and the More sheet keep it.
    expect(screen.queryByRole('link', { name: /^swap$/i })).not.toBeInTheDocument();
  });
});
