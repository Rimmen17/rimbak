// Notifications on the phone (web push). The sending side is the Supabase
// function in supabase/functions/notify.
let registration = null;

// The public sending key as the bytes the browser asks for.
export function keyToBytes(base64url) {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iPhone and iPad only offer push to a site opened from the home screen.
export function needsHomeScreen() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && !supported();
}

export function blocked() {
  return supported() && Notification.permission === 'denied';
}

export async function init() {
  if (supported()) registration = await navigator.serviceWorker.register('sw.js');
}

export async function current() {
  return registration ? registration.pushManager.getSubscription() : null;
}

// Must be called from a tap: the browser only asks for permission then.
export async function enable(publicKey) {
  if (!registration) throw new Error('Notifikationer virker ikke i denne browser');
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Notifikationer er ikke tilladt. Slå dem til for Rimbak i enhedens indstillinger.');
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyToBytes(publicKey),
  });
}

export async function disable() {
  const sub = await current();
  if (sub) await sub.unsubscribe();
  return sub;
}
