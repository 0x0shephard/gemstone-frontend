import { env } from '@/config/env';
import { analyticsPath, readUtm, sanitizeProperties, type UtmTags } from './attribution';
import { recordDiagnostic } from './diagnostics';
import { startMetaPixel, stopMetaPixel, trackMetaPixel } from './metaPixel';

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

/*
 * The campaign tags a visitor arrived with, held in memory only. They are sent
 * nowhere until the visitor accepts analytics, which may happen pages later.
 */
const landingUtm: UtmTags = typeof window === 'undefined' ? {} : readUtm(window.location.search);

/** Campaign tags to carry through a sign-in email so the return visit keeps them. */
export function campaignTags(): UtmTags {
  return { ...landingUtm, ...readUtm(window.location.search) };
}

/** Whether any analytics tool is configured, which is when the consent banner shows. */
export function analyticsConfigured(): boolean {
  return Boolean(env.posthogKey || env.metaPixelId);
}

/** True once the visitor has answered the consent banner either way. */
export function analyticsConsentDecided(): boolean {
  const value = localStorage.getItem(CONSENT_KEY);
  return value === 'granted' || value === 'denied';
}

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
  if (localStorage.getItem(CONSENT_KEY) !== 'granted') return;
  if (env.posthogKey) {
    void loadPostHog().then((client) => {
      if (!client || client.__loaded) return;
      client.init(env.posthogKey, {
        api_host: env.posthogHost,
        autocapture: false,
        // Sent by `capturePageView` after each navigation, with a cleaned address.
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'never',
        persistence: 'localStorage',
        // No feature flags or remote scripts: the flags request carries the raw
        // first address, which `before_send` never sees.
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        // Addresses can carry gift codes and sign-in tokens; see attribution.ts.
        before_send: (event) => (event ? sanitizeProperties(event, window.location.origin) : event),
      });
      const first = Object.fromEntries(
        Object.entries(landingUtm).map(([key, value]) => [`landing_${key}`, value]),
      );
      if (Object.keys(first).length > 0) client.register_once(first);
      // The page the visitor is on when tracking starts; later ones come from
      // `capturePageView`. Promise callbacks run in order, so init comes first.
      client.capture('$pageview');
    });
  }
  if (env.metaPixelId) {
    startMetaPixel(env.metaPixelId);
    trackMetaPixel('PageView');
  }
  lastPageView = pageKey();
}

/** For the app's error boundary. Does nothing when no reporting is configured. */
export function captureError(error: unknown) {
  void sentry?.then((client) => client?.captureException(error));
}

export function setAnalyticsConsent(enabled: boolean) {
  localStorage.setItem(CONSENT_KEY, enabled ? 'granted' : 'denied');
  if (enabled) initializeTelemetry();
  if (env.posthogKey && posthog) {
    void loadPostHog().then((client) =>
      enabled ? client?.opt_in_capturing() : client?.opt_out_capturing(),
    );
  }
  if (!enabled) stopMetaPixel();
  window.dispatchEvent(new Event('dc:analytics-consent'));
}

export function hasAnalyticsConsent(): boolean {
  return localStorage.getItem(CONSENT_KEY) === 'granted';
}

let lastPageView = '';

function pageKey(): string {
  return `${analyticsPath(window.location.pathname)}${window.location.search}`;
}

/**
 * One page view per navigation, to both tools. The router reports every state
 * change, so repeats of the same address are dropped.
 */
export function capturePageView() {
  if (!hasAnalyticsConsent()) return;
  const key = pageKey();
  if (key === lastPageView) return;
  lastPageView = key;
  if (env.posthogKey) void loadPostHog().then((client) => client?.capture('$pageview'));
  trackMetaPixel('PageView');
}

export type ClaimStep = 'viewed' | 'email_verified' | 'wallet_verified' | 'completed';

const PIXEL_CLAIM_EVENTS: Record<ClaimStep, { event: string; custom: boolean }> = {
  viewed: { event: 'ViewContent', custom: false },
  email_verified: { event: 'Lead', custom: false },
  wallet_verified: { event: 'WalletVerified', custom: true },
  completed: { event: 'CompleteRegistration', custom: false },
};

/**
 * The claim funnel (QR or gift link → email → wallet → claimed). `code` is a
 * public promotional code only; gift card codes are secret and never passed.
 */
export function captureClaimStep(
  step: ClaimStep,
  properties: { flow: 'promo' | 'gift'; code?: string; result?: string },
) {
  if (!hasAnalyticsConsent()) return;
  if (env.posthogKey) {
    void loadPostHog().then((client) => client?.capture(`claim_${step}`, properties));
  }
  const pixel = PIXEL_CLAIM_EVENTS[step];
  trackMetaPixel(
    pixel.event,
    {
      content_category: properties.flow,
      ...(properties.code ? { content_name: properties.code } : {}),
    },
    pixel.custom,
  );
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
