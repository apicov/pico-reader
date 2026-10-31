/** Words marked as known, and the words looked up before (to mark them in the text), per language.
 *  Both are kept on the device for offline reading and refreshed from the server when online. */
import { api } from '@/services/api';
import { fetchCached } from '@/services/cachedFetch';
import { getPref, setPref } from '@/services/prefs';
import { deleteCardsFor } from '@/services/review';
import { createSignal } from '@/utils/signal';

export async function lookedUpWords(language: string): Promise<Set<string>> {
  return new Set(await fetchCached<string[]>(`/api/looked-up-words?language=${encodeURIComponent(language)}`,
    `looked_up:${language}`, []));
}

const lookedUpChanges = createSignal<string>();

/** Called with the language whenever the device's looked-up words change (a lookup, a word marked known). */
export const subscribeLookedUp = lookedUpChanges.subscribe;

/** The device's copy of the looked-up words (no server call: it may not have the newest lookups yet). */
export async function cachedLookedUpWords(language: string): Promise<Set<string>> {
  return new Set((await getPref<string[]>(`looked_up:${language}`)) ?? []);
}

/** A word found in a dictionary was looked up: it's underlined at once (the server learns of it later). */
export async function addLookedUp(language: string, words: string[]): Promise<void> {
  const key = `looked_up:${language}`;
  const cached = new Set((await getPref<string[]>(key)) ?? []);
  const add = words.filter(Boolean).map((w) => w.normalize('NFC').toLowerCase()).filter((w) => !cached.has(w));
  if (!add.length) return;
  await setPref(key, [...cached, ...add]);
  lookedUpChanges.emit(language);
}

/** Mark a word known: it leaves the review, the "keep looking up" list and the underlines. */
export async function markKnown(language: string, word: string): Promise<void> {
  await api('/api/known-words', { method: 'PUT', body: { language, word } });
  const key = `looked_up:${language}`;
  const cached = (await getPref<string[]>(key)) ?? [];
  const known = word.normalize('NFC').toLowerCase(); // as addLookedUp stored it
  await setPref(key, cached.filter((w) => w !== known));
  lookedUpChanges.emit(language);
  await deleteCardsFor(language, word);
}
