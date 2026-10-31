/** Server data the app also shows offline */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

/** The server's answer when online (and kept on the device), else (offline, or the server failing) the device's
 *  last copy, else `fallback` */
export async function fetchCached<T>(path: string, key: string, fallback: T): Promise<T> {
  if (isOnline()) {
    try {
      const value = await api<T>(path);
      await setPref(key, value);
      return value;
    } catch { /* the device's copy */ }
  }
  return (await getPref<T>(key)) ?? fallback;
}
