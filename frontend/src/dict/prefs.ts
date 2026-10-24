/**
 * Which dictionaries the reader switched off and their order per language. Kept in the account (the server's
 * settings, so every device agrees) and on the device for offline use; a change made offline is sent later.
 */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

export interface DictPrefs {
  disabled: string[];
  /** per language (of the headwords): dictionary ids, the first shown first */
  order: Record<string, string[]>;
}

const KEY = 'dict_prefs';
const DIRTY = 'dict_prefs_dirty';
const OLD_PREFERRED = 'dict_preferred'; // before: the ★ per language, on one device only
const EMPTY: DictPrefs = { disabled: [], order: {} };
const listeners = new Set<() => void>();

export function subscribeDictPrefs(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function dictPrefs(): Promise<DictPrefs> {
  const prefs = (await getPref<DictPrefs>(KEY)) ?? { ...EMPTY };
  // once: the old per-device ★ becomes the first of its language
  const old = await getPref<Record<string, string>>(OLD_PREFERRED);
  if (old) {
    for (const [lang, id] of Object.entries(old)) prefs.order[lang] = [id, ...(prefs.order[lang] ?? []).filter((x) => x !== id)];
    await setPref(OLD_PREFERRED, null);
    await saveDictPrefs(prefs);
  }
  return prefs;
}

async function push(): Promise<void> {
  if (!isOnline() || !(await getPref<boolean>(DIRTY))) return;
  const prefs = (await getPref<DictPrefs>(KEY)) ?? EMPTY;
  await api('/api/settings', { method: 'PUT', body: { dictionaries: prefs } });
  await setPref(DIRTY, false);
}

export async function saveDictPrefs(prefs: DictPrefs): Promise<void> {
  await setPref(KEY, prefs);
  await setPref(DIRTY, true);
  listeners.forEach((l) => l());
  await push().catch(() => undefined);
}

/** At start and on the Dictionaries page: send a change made offline, else take the account's. */
export async function syncDictPrefs(): Promise<DictPrefs> {
  const local = await dictPrefs();
  if (!isOnline()) return local;
  try {
    if (await getPref<boolean>(DIRTY)) {
      await push();
      return local;
    }
    const remote = (await api<{ dictionaries?: DictPrefs }>('/api/settings')).dictionaries ?? EMPTY;
    await setPref(KEY, remote);
    if (JSON.stringify(remote) !== JSON.stringify(local)) listeners.forEach((l) => l());
    return remote;
  } catch {
    return local;
  }
}

export async function setDictEnabled(id: string, enabled: boolean): Promise<void> {
  const prefs = await dictPrefs();
  prefs.disabled = enabled ? prefs.disabled.filter((x) => x !== id) : [...new Set([...prefs.disabled, id])];
  await saveDictPrefs(prefs);
}

/** The new order of a language's dictionaries (ids not listed keep coming after). */
export async function setDictOrder(language: string, ids: string[]): Promise<void> {
  const prefs = await dictPrefs();
  prefs.order[language] = ids;
  await saveDictPrefs(prefs);
}

/** Sorts by the reader's order: listed ones first, in that order; the rest keep their order after them. */
export function byOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  const rank = (id: string) => { const i = order?.indexOf(id) ?? -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.i - b.i).map((x) => x.item);
}
