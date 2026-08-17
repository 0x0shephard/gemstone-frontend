import { Component, type ReactNode } from 'react';

/**
 * Keeps a decorative canvas from taking the page with it.
 *
 * `GemScene` is ornament: a stone that turns above the landing copy. WebGL fails
 * for reasons that have nothing to do with this app — a context the browser
 * refuses under memory pressure, a driver blocklist, a phone that has simply run
 * out of contexts across tabs — and that failure was reaching the app-wide fatal
 * boundary. Losing the entire landing page, including the sign-in route, because
 * an animation could not start is a poor trade on a device that is already
 * struggling.
 *
 * A class component because React offers no hook for this; `componentDidCatch`
 * is still the only way to catch a render error from below.
 */
export class SceneBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      // Deliberately not an error message. Nothing was lost that the reader
      // needs to know about, and the space it occupied was decorative.
      return this.props.fallback ?? <div aria-hidden className="h-full w-full" />;
    }
    return this.props.children;
  }
}
