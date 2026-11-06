import { Component, type ReactNode } from 'react';
import { captureError } from '@/lib/telemetry';

interface State {
  failed: boolean;
}

/** Catches render errors. Kept free of Sentry so the entry file does not carry it. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    captureError(error);
  }

  render() {
    if (this.state.failed) {
      return <p role="alert">Digital Carat encountered an unexpected error.</p>;
    }
    return this.props.children;
  }
}
