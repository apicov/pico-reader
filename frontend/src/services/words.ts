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

/** Mark a word known: it leaves the review, the "keep looking up" list and the underlines. */
export async function markKnown(language: string, word: string): Promise<void> {
  await api('/api/known-words', { method: 'PUT', body: { language, word } });
  const key = `looked_up:${language}`;
  const cached = (await getPref<string[]>(key)) ?? [];
  await setPref(key, cached.filter((w) => w !== word.toLowerCase()));
  await deleteCardsFor(language, word);
}

/** Wrap words of `words` in <span class="seen"> in an element's text (not inside code or math). */
export function markSeenWords(root: HTMLElement, words: Set<string>): void {
  if (!words.size) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, .katex, .math, script, style, .seen')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) nodes.push(n);
  const re = /\p{L}[\p{L}\p{M}'’-]*/gu;
  for (const node of nodes) {
    const text = node.data;
    let m: RegExpExecArray | null;
    let last = 0;
    const parts: (string | HTMLElement)[] = [];
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (!words.has(m[0].normalize('NFC').toLowerCase())) continue;
      if (m.index > last) parts.push(text.slice(last, m.index));
      const span = doc.createElement('span');
      span.className = 'seen';
      span.textContent = m[0];
      parts.push(span);
      last = m.index + m[0].length;
    }
    if (!parts.length) continue;
    if (last < text.length) parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
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
