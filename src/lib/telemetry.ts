import * as Sentry from '@sentry/react';
import posthog from 'posthog-js';
import { env } from '@/config/env';

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
  if (env.sentryDsn) {
    Sentry.init({
      dsn: env.sentryDsn,
      environment: env.dataMode,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend: (event) => scrub(event) as typeof event,
    });
  }
  if (env.posthogKey && localStorage.getItem(CONSENT_KEY) === 'granted') {
    posthog.init(env.posthogKey, {
      api_host: env.posthogHost,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      person_profiles: 'never',
      persistence: 'localStorage',
    });
  }
}

export function setAnalyticsConsent(enabled: boolean) {
  localStorage.setItem(CONSENT_KEY, enabled ? 'granted' : 'denied');
  if (!enabled) posthog.opt_out_capturing();
  else if (env.posthogKey) {
    initializeTelemetry();
    posthog.opt_in_capturing();
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
  if (!allowedEvents.has(event) || !hasAnalyticsConsent()) return;
  posthog.capture(event, properties);
}
