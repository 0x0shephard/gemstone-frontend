import { useEffect } from 'react';

/**
 * Adds the `.dc-in` class to `[data-reveal]` elements as they scroll into view,
 * mirroring the mockup's reveal-on-scroll effect. Idempotent; safe to mount on
 * any page. Respects prefers-reduced-motion via CSS (elements are visible by
 * default there). A fallback timeout guarantees nothing stays hidden.
 */
export function useScrollReveal(deps: readonly unknown[] = []): void {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (els.length === 0) return;

    els.forEach((el) => {
      const d = el.getAttribute('data-reveal-delay');
      if (d && d !== '0') el.style.transitionDelay = `${d}ms`;
    });

    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('dc-in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('dc-in');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px' },
    );

    els.forEach((el) => observer.observe(el));
    const fallback = setTimeout(() => els.forEach((el) => el.classList.add('dc-in')), 2600);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
