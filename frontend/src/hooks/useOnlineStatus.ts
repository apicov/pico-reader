/**
 * Custom Hook: useOnlineStatus
 *
 * PURPOSE:
 * ========
 * Tracks network connectivity status (online/offline) across the app.
 * Provides a reusable way to detect when user is online or offline.
 *
 * HOW IT WORKS:
 * =============
 * Thin React wrapper over the shared `services/connectivity` source, which uses the
 * @capacitor/network plugin on native (accurate) and navigator.onLine on web. It reads the
 * current value on mount and re-renders when connectivity changes, unsubscribing on unmount.
 *
 * WHEN EVENTS FIRE:
 * =================
 * - User disconnects WiFi → 'offline' event
 * - User reconnects WiFi → 'online' event
 * - Laptop wakes from sleep with no WiFi → 'offline' event
 * - Mobile loses cell signal → 'offline' event
 *
 * LIMITATIONS:
 * ============
 * - Reflects device connectivity, not reachability: can read "online" on WiFi with no internet.
 * - On native, the first read right at launch may be stale for a few ms until the Network
 *   plugin's initial getStatus() resolves; it then corrects via subscription.
 *
 * USAGE:
 * ======
 * const isOnline = useOnlineStatus();
 *
 * if (isOnline) {
 *   // Sync with server
 * } else {
 *   // Use cached data only
 * }
 *
 * @returns Boolean indicating if user is online
 */
import { useState, useEffect } from 'react';
import { isOnline as getIsOnline, subscribeOnline } from '../services/connectivity';

export function useOnlineStatus(): boolean {
    const [online, setOnline] = useState<boolean>(getIsOnline());

    // Subscribe to the shared connectivity source (Network plugin on native, navigator.onLine on
    // web). subscribeOnline returns its own unsubscribe, which becomes the effect cleanup.
    useEffect(() => subscribeOnline(setOnline), []);

    return online;
}

