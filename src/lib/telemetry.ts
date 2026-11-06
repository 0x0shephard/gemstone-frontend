import { env } from '@/config/env';
import { recordDiagnostic } from './diagnostics';

/*
 * Both libraries load only when configured. Imported statically they sat in the
 * entry file, so every visitor downloaded and parsed them before the first page
 * could render, whether or not anything was going to be reported.
 */
type Sentry = typeof import('@sentry/react');
type PostHog = (typeof import('posthog-js'))['default'];

let sentry: Promise<Sentry | undefined> | undefined;
let posthog: Promise<PostHog | undefined> | undefined;

function loadPostHog(): Promise<PostHog | undefined> {
  posthog ??= import('posthog-js').then(
    (module) => module.default,
    () => undefined,
  );
  return posthog;
}

const ADDRESS = /0x[a-fA-F0-9]{40}/g;
const SENSITIVE_KEYS =
  /signature|address|wallet|certificate|delivery|recipient|email|name|form|payload/i;
const CONSENT_KEY = 'dc.analyticsConsent';

function scrub(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEYS.test(key)) return '[Filtered]';
  if (typeof value === 'string') return value.replaceAll(ADDRESS, '[Address]');
  if (Array.isArray(value)) return value.map((child) => scrub(child));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, scrub(child, childKey)]),
    );
  }
  return value;
}

export function initializeTelemetry() {
  if (env.sentryDsn && !sentry) {
    sentry = import('@sentry/react').then(
      (client) => {
        client.init({
          dsn: env.sentryDsn,
          environment: env.dataMode,
          tracesSampleRate: 0.1,
          sendDefaultPii: false,
          beforeSend: (event) => scrub(event) as typeof event,
        });
        return client;
      },
      () => undefined,
    );
  }
  if (env.posthogKey && localStorage.getItem(CONSENT_KEY) === 'granted') {
    void loadPostHog().then((client) =>
      client?.init(env.posthogKey, {
        api_host: env.posthogHost,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'never',
        persistence: 'localStorage',
      }),
    );
  }
}

/** For the app's error boundary. Does nothing when no reporting is configured. */
export function captureError(error: unknown) {
  void sentry?.then((client) => client?.captureException(error));
}

export function setAnalyticsConsent(enabled: boolean) {
  localStorage.setItem(CONSENT_KEY, enabled ? 'granted' : 'denied');
  if (env.posthogKey) {
    if (enabled) initializeTelemetry();
    void loadPostHog().then((client) =>
      enabled ? client?.opt_in_capturing() : client?.opt_out_capturing(),
    );
  }
  window.dispatchEvent(new Event('dc:analytics-consent'));
}

export function hasAnalyticsConsent(): boolean {
  return localStorage.getItem(CONSENT_KEY) === 'granted';
}

const allowedEvents = new Set([
  'onboarding_step',
  'transaction_started',
  'transaction_confirmed',
  'transaction_failed',
]);

export function captureProductEvent(
  event: 'onboarding_step' | 'transaction_started' | 'transaction_confirmed' | 'transaction_failed',
  properties: { flow: string; step?: string; paymentAsset?: 'ETH' | 'USDC'; result?: string },
) {
  // Local only, and independent of analytics consent: it never leaves the device.
  if (event !== 'onboarding_step') {
    recordDiagnostic('tx', `${event.replace('transaction_', '')} ${properties.flow}`, {
      result: properties.result ?? null,
    });
  }
  if (!allowedEvents.has(event) || !hasAnalyticsConsent()) return;
  if (env.posthogKey) void loadPostHog().then((client) => client?.capture(event, properties));
}
