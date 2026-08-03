import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollReveal } from './useScrollReveal';

/**
 * `[data-reveal]` is `opacity: 0` until `.dc-in` is added, so an element that is
 * never observed is invisible permanently — it renders, screen readers announce
 * it, it copies to the clipboard, and a sighted user sees nothing. That is what
 * happened to every gem card on the profile and seller pages.
 */

let observed: Element[] = [];
let trigger: (elements: Element[]) => void = () => {};

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    trigger = (elements) =>
      callback(
        elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
        this as unknown as IntersectionObserver,
      );
  }
  observe(element: Element) {
    observed.push(element);
  }
  unobserve() {}
  disconnect() {}
}

function Harness() {
  useScrollReveal([]);
  return <div data-reveal data-testid="present-at-mount" />;
}

/** Appends a `[data-reveal]` node the way a resolved query would. */
function addLateCard(id: string) {
  const card = document.createElement('article');
  card.setAttribute('data-reveal', '');
  card.setAttribute('data-testid', id);
  document.body.appendChild(card);
  return card;
}

const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  observed = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useScrollReveal', () => {
  it('observes elements present when it mounts', () => {
    render(<Harness />);
    expect(observed.some((el) => el.getAttribute('data-testid') === 'present-at-mount')).toBe(true);
  });

  it('observes elements added after mount', async () => {
    // The regression. Cards arrive when an async query resolves, long after the
    // effect ran; a single pass over the DOM never sees them.
    render(<Harness />);
    const late = addLateCard('late-card');
    await flushMutations();
    expect(observed).toContain(late);
  });

  it('reveals an observed element once it intersects', async () => {
    render(<Harness />);
    const late = addLateCard('late-card');
    await flushMutations();
    trigger([late]);
    expect(late.classList.contains('dc-in')).toBe(true);
  });

  it('reveals everything if no observer is available at all', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const orphan = addLateCard('orphan');
    render(<Harness />);
    expect(orphan.classList.contains('dc-in')).toBe(true);
  });

  it('falls back to revealing everything even if nothing ever intersects', async () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const late = addLateCard('late-card');
      vi.advanceTimersByTime(3_000);
      expect(late.classList.contains('dc-in')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
