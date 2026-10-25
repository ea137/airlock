// Push notifications on this phone: whether it can have them, whether
// they're on, and turning them on and off. On an iPhone, a website gets
// them only once it's on the Home Screen and opened from there.

import { api } from '../../lib/api';

export type PushStatus =
  /** This browser has no push at all. */
  | 'unsupported'
  /** An iPhone or iPad in Safari: it needs adding to the Home Screen first. */
  | 'home-screen'
  /** Notifications were refused; only the phone's settings can allow them now. */
  | 'blocked'
  | 'off'
  | 'on';

/** How long to wait for the service worker before giving up. */
const READY_MS = 5000;

/** Registers the service worker that shows notifications; nothing breaks without it. */
export function registerWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
    // No notifications, then.
  });
}

function onIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("the phone's service worker didn't start")), READY_MS),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return onIos() && !standalone() ? 'home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const subscription = await (await registration()).pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const text = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Asks for permission (call it straight from a tap: iOS asks only then),
 * subscribes, and tells the hub where to send. */
export async function turnOn(): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const [{ key }, ready] = await Promise.all([api.pushKey(), registration()]);
  const existing = await ready.pushManager.getSubscription();
  const subscription =
    existing ?? (await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("the phone's push service gave no address");
  await api.pushSubscribe({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  return 'on';
}

export async function turnOff(): Promise<PushStatus> {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (subscription) {
    await api.pushUnsubscribe(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return 'off';
}
