/** Words marked as known, and the words looked up before (to mark them in the text), per language.
 *  Both are kept on the device for offline reading and refreshed from the server when online. */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import { deleteCardsFor } from '@/services/review';

export async function lookedUpWords(language: string): Promise<Set<string>> {
  const key = `looked_up:${language}`;
  if (isOnline()) {
    try {
      const words = await api<string[]>(`/api/looked-up-words?language=${encodeURIComponent(language)}`);
      await setPref(key, words);
      return new Set(words);
    } catch { /* fall back to the device's copy */ }
  }
  return new Set((await getPref<string[]>(key)) ?? []);
}

const lookedUpListeners = new Set<(language: string) => void>();

/** Called with the language whenever the device's looked-up words change (a lookup, a word marked known). */
export function subscribeLookedUp(listener: (language: string) => void): () => void {
  lookedUpListeners.add(listener);
  return () => { lookedUpListeners.delete(listener); };
}

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
  lookedUpListeners.forEach((l) => l(language));
}

/** Mark a word known: it leaves the review, the "keep looking up" list and the underlines. */
export async function markKnown(language: string, word: string): Promise<void> {
  await api('/api/known-words', { method: 'PUT', body: { language, word } });
  const key = `looked_up:${language}`;
  const cached = (await getPref<string[]>(key)) ?? [];
  await setPref(key, cached.filter((w) => w !== word.toLowerCase()));
  lookedUpListeners.forEach((l) => l(language));
  await deleteCardsFor(language, word);
}

/** Where the words of `words` are in an element's text (not inside code or math): per text node, the matches. */
function seenMatches(root: HTMLElement, words: Set<string>): { node: Text; spans: [number, number][] }[] {
  if (!words.size) return [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, .katex, .math, math, mjx-container, script, style, .seen')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const out: { node: Text; spans: [number, number][] }[] = [];
  const re = /\p{L}[\p{L}\p{M}'’-]*/gu;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const spans: [number, number][] = [];
    for (const m of node.data.matchAll(re)) {
      if (words.has(m[0].normalize('NFC').toLowerCase())) spans.push([m.index, m.index + m[0].length]);
    }
    if (spans.length) out.push({ node, spans });
  }
  return out;
}

/** Wrap words of `words` in <span class="seen"> in an element's text (not inside code or math). */
export function markSeenWords(root: HTMLElement, words: Set<string>): void {
  const doc = root.ownerDocument;
  for (const { node, spans } of seenMatches(root, words)) {
    const text = node.data;
    const parts: (string | HTMLElement)[] = [];
    let last = 0;
    for (const [from, to] of spans) {
      if (from > last) parts.push(text.slice(last, from));
      const span = doc.createElement('span');
      span.className = 'seen';
      span.textContent = text.slice(from, to);
      parts.push(span);
      last = to;
    }
    if (last < text.length) parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
}

/** The words of `words` in an element's text as ranges, leaving the DOM as it is (EPUB positions count its
 *  nodes, so wrapping words in spans would move every highlight saved after them). */
export function seenWordRanges(root: HTMLElement, words: Set<string>): Range[] {
  const doc = root.ownerDocument;
  return seenMatches(root, words).flatMap(({ node, spans }) => spans.map(([from, to]) => {
    const range = doc.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    return range;
  }));
}

/** How often each word of `words` appears in a text, most frequent first (the "words in this chapter" list). */
export function wordsIn(text: string, words: Set<string>): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\p{L}[\p{L}\p{M}'’-]*/gu)) {
    const w = m[0].normalize('NFC').toLowerCase();
    if (words.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
