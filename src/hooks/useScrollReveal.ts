import { useEffect } from 'react';

/**
 * Adds the `.dc-in` class to `[data-reveal]` elements as they scroll into view,
 * mirroring the mockup's reveal-on-scroll effect. Idempotent; safe to mount on
 * any page. Respects prefers-reduced-motion via CSS (elements are visible by
 * default there). A fallback timeout guarantees nothing stays hidden.
 *
 * `[data-reveal]` is `opacity: 0` until revealed, so an element carrying that
 * attribute on a page that never ran this hook is invisible *permanently*: it
 * renders, a screen reader announces it, it copies to the clipboard, and a
 * sighted user sees nothing. `GemCard` sets the attribute unconditionally, which
 * is why every gem on the profile and seller pages was blank.
 *
 * Two observers, because either alone leaves a hole:
 *  - an IntersectionObserver over what is in the DOM now, and
 *  - a MutationObserver for nodes added afterwards, which is every card on a
 *    page whose contents arrive from an async query.
 */
export function useScrollReveal(deps: readonly unknown[] = []): void {
  useEffect(() => {
    const applyDelay = (element: HTMLElement) => {
      const delay = element.getAttribute('data-reveal-delay');
      if (delay && delay !== '0') element.style.transitionDelay = `${delay}ms`;
    };

    const revealAll = () => {
      document
        .querySelectorAll<HTMLElement>('[data-reveal]')
        .forEach((element) => element.classList.add('dc-in'));
    };

    // Checks the value, not just the key: a global that is present but undefined
    // passes an `in` test and then throws on construction, which would leave
    // every card hidden — the exact failure this guard exists to prevent.
    if (typeof IntersectionObserver !== 'function' || typeof MutationObserver !== 'function') {
      revealAll();
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

    const observe = (root: ParentNode) => {
      if (root instanceof HTMLElement && root.hasAttribute('data-reveal')) {
        applyDelay(root);
        observer.observe(root);
      }
      root.querySelectorAll<HTMLElement>('[data-reveal]:not(.dc-in)').forEach((element) => {
        applyDelay(element);
        observer.observe(element);
      });
    };

    observe(document);

    /*
     * Cards rendered once a query resolves are not in the DOM when this effect
     * runs. Without watching for them they are never observed, never receive
     * `.dc-in`, and stay at zero opacity for the lifetime of the page.
     */
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) observe(node);
        });
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    // Last resort. A card that skips its animation is a far smaller failure than
    // one that never appears.
    const fallback = setTimeout(revealAll, 2_600);

    return () => {
      observer.disconnect();
      mutations.disconnect();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
