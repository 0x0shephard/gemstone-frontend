/**
 * Meta (Facebook/Instagram) Pixel, loaded only after analytics consent and only
 * when `VITE_META_PIXEL_ID` is set. It tells Meta which ad visitors went on to
 * claim, so boosted posts are shown to people likely to finish, not just click.
 *
 * The Pixel reads the full page address itself, so every call is skipped on
 * pages that can carry a secret (see `pageIsShareable`).
 */
import { pageIsShareable } from './attribution';

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let initialized = false;

/** Meta's loader, without the inline script: queues calls until fbevents.js arrives. */
function installStub(): Fbq {
  if (window.fbq) return window.fbq;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq ??= fbq;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
  return fbq;
}

export function startMetaPixel(pixelId: string) {
  if (!pixelId) return;
  const fbq = installStub();
  if (initialized) {
    fbq('consent', 'grant');
    return;
  }
  // Page views are sent by the app after cleaning; stop the Pixel sending its
  // own on every in-app navigation, and from collecting button text.
  (fbq as unknown as { disablePushState?: boolean }).disablePushState = true;
  fbq('set', 'autoConfig', false, pixelId);
  fbq('consent', 'grant');
  fbq('init', pixelId);
  initialized = true;
}

export function stopMetaPixel() {
  if (window.fbq && initialized) window.fbq('consent', 'revoke');
}

export function trackMetaPixel(
  event: string,
  parameters: Record<string, string | number> = {},
  custom = false,
) {
  if (!initialized || !window.fbq || !pageIsShareable(window.location)) return;
  window.fbq(custom ? 'trackCustom' : 'track', event, parameters);
}
