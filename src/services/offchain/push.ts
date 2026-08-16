import { supabase } from '@/providers/supabase';

/**
 * Web Push subscription, from the browser's side.
 *
 * A subscription belongs to a device, not to an account: the same person on a
 * laptop and a phone registers twice, and both should ring. The server stores
 * one row per endpoint and retires it when the push service says it is gone.
 */

/** The application server key, as an uncompressed P-256 point. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState =
  /** The browser has no Push API, or the page is not in a secure context. */
  | 'unsupported'
  /** No VAPID key is configured, so there is nothing to subscribe to. */
  | 'unconfigured'
  /** Permission has been refused; the browser will not ask again. */
  | 'denied'
  | 'subscribed'
  | 'unsubscribed';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    // Push requires a secure context. localhost counts; a LAN IP does not, and
    // the failure there is an unhelpful registration error.
    window.isSecureContext
  );
}

/** base64url → the `Uint8Array` `pushManager.subscribe` insists on. */
function decodeKey(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function keyOf(subscription: PushSubscription, name: 'p256dh' | 'auth'): string {
  const key = subscription.getKey(name);
  if (!key) throw new Error(`Subscription is missing its ${name} key`);
  let binary = '';
  for (const byte of new Uint8Array(key)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** What the current device's subscription state is, without changing it. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = await (await registration()).pushManager.getSubscription();
  return subscription ? 'subscribed' : 'unsubscribed';
}

/**
 * Subscribes this device and records it against the signed-in account.
 *
 * Prompts for permission, which browsers only allow in response to a gesture —
 * so this must be called from a click, never on load.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (!supabase) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'unsubscribed';

  const subscription = await (
    await registration()
  ).pushManager.subscribe({
    // Required by every implementation, and the reason a silent subscription
    // that reaches no one is not possible here.
    userVisibleOnly: true,
    applicationServerKey: decodeKey(VAPID_PUBLIC_KEY) as BufferSource,
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user) return 'unsubscribed';

  // Keyed on the endpoint: re-running this on a device that is already
  // registered updates the row rather than accumulating duplicates, and clears
  // any earlier retirement.
  await supabase.from('push_subscriptions').upsert(
    {
      profile_id: data.user.id,
      endpoint: subscription.endpoint,
      p256dh: keyOf(subscription, 'p256dh'),
      auth: keyOf(subscription, 'auth'),
      user_agent: navigator.userAgent.slice(0, 400),
      expired_at: null,
    },
    { onConflict: 'endpoint' },
  );

  return 'subscribed';
}

/** Unsubscribes this device and forgets it server-side. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return 'unsubscribed';

  // Server first. Unsubscribing locally before the row is gone would leave the
  // sweep pushing to an endpoint nobody is listening on until it 410s.
  if (supabase) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  }
  await subscription.unsubscribe();
  return 'unsubscribed';
}
