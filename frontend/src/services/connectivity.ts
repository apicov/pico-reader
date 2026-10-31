/**
 * Online or offline, one source for the whole app. On Android the WebView's `navigator.onLine` is unreliable (it
 * often says online in airplane mode, which quietly breaks everything offline), so there the Network plugin's
 * status is used, kept here as it changes; on the web `navigator.onLine` is accurate and read live.
 * `isOnline()` reads it at once (e.g. in loaders); `subscribeOnline()` follows changes (`useOnlineStatus`).
 */
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
const isNative = Capacitor.isNativePlatform();

// Android: online until the first getStatus() answers (a few ms after launch); listeners then get the real value
let nativeOnline = true;

function notify(): void {
  const value = isOnline();
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.warn('[connectivity] listener threw:', error);
    }
  }
}

if (isNative) {
  Network.getStatus()
    .then((status) => { nativeOnline = status.connected; notify(); })
    .catch((error) => console.warn('[connectivity] Network.getStatus failed:', error));
  // for the app's lifetime: never removed
  void Network.addListener('networkStatusChange', (status) => {
    nativeOnline = status.connected;
    notify();
  });
} else if (typeof window !== 'undefined') {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
}

export function isOnline(): boolean {
  if (isNative) return nativeOnline;
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** Returns what unsubscribes */
export function subscribeOnline(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
