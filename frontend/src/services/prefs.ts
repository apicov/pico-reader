/** Small JSON values that must survive restarts (Capacitor Preferences: SharedPreferences on Android,
 *  localStorage on the web). Books and dictionaries live elsewhere; this is for settings and caches
 *  of a few KB. */
import { Preferences } from '@capacitor/preferences';

export async function getPref<T>(key: string): Promise<T | null> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function setPref(key: string, value: unknown): Promise<void> {
  if (value === null || value === undefined) await Preferences.remove({ key });
  else await Preferences.set({ key, value: JSON.stringify(value) });
}
