/**
 * connectivity — single source of truth for online/offline status.
 *
 * WHY THIS EXISTS:
 * On native (Capacitor) the WebView's `navigator.onLine` is unreliable — it frequently reports
 * `true` in airplane mode, which silently breaks every offline behaviour that keys off it. So on
 * native we use the `@capacitor/network` plugin (accurate, event-driven) and cache its status; on
 * web `navigator.onLine` + window events are accurate, so we read them live.
 *
 * Use `isOnline()` for a synchronous read (e.g. in loaders) and `subscribeOnline()` to react to
 * changes (the `useOnlineStatus` hook wraps this).
 */

import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';


type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
const isNative = Capacitor.isNativePlatform();

// Native-only cache of the Network plugin's status. Defaults to online until the first
// getStatus() resolves (a few ms after launch); listeners correct any stale initial read.
let nativeOnline = true;

function notify(): void {
    const value = isOnline();
    for (const cb of listeners) {
        try {
            cb(value);
        } catch (error) {
            console.warn('[connectivity] listener threw:', error);
        }
    }
}

if (isNative) {
    Network.getStatus()
        .then((status) => { nativeOnline = status.connected; notify(); })
        .catch((error) => console.warn('[connectivity] Network.getStatus failed:', error));

    // App-lifetime listener; the returned handle is intentionally not stored/removed.
    void Network.addListener('networkStatusChange', (status) => {
        nativeOnline = status.connected;
        notify();
    });
} else if (typeof window !== 'undefined') {
    window.addEventListener('online', notify);
    window.addEventListener('offline', notify);
}

/** Current connectivity: Network plugin on native, live `navigator.onLine` on web. */
export function isOnline(): boolean {
    if (isNative) return nativeOnline;
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function subscribeOnline(cb: Listener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}
