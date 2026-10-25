/** Whether offline search is on, and which books can be searched offline (their search file is on the device). */
import { cachedFiles, ensureSearchFile } from '@/services/bookCache';
import { getPref, setPref } from '@/services/prefs';
import type { Book } from '@/services/types';

const KEY = 'offline_search';
const WORDS_ONLY = 'offline_search_words_only';

export const offlineSearchEnabled = async () => (await getPref<boolean>(KEY)) ?? false;
export const setOfflineSearch = (on: boolean) => setPref(KEY, on);
/** The model can't run here (an old WebView without WebAssembly SIMD): offline search matches words only */
export const offlineSearchWordsOnly = async () => (await getPref<boolean>(WORDS_ONLY)) ?? false;
export const setOfflineSearchWordsOnly = (on: boolean) => setPref(WORDS_ONLY, on);

/** Downloaded books whose search file is on the device */
export async function searchableOffline(books: Book[]): Promise<Book[]> {
  const files = await cachedFiles();
  const have = new Set(files.filter((f) => f.kind === 'search').map((f) => `${f.bookId}:${f.sha256}`));
  return books.filter((b) => b.search && have.has(`${b.id}:${b.search.sha256}`));
}

/** Fetch the search files of the books that are on the device (any reading format downloaded). */
export async function fetchSearchFiles(books: Book[]): Promise<number> {
  const files = await cachedFiles();
  const downloaded = new Set(files.filter((f) => f.kind !== 'cover' && f.kind !== 'search').map((f) => f.bookId));
  let n = 0;
  for (const b of books) {
    if (downloaded.has(b.id) && b.search && (await ensureSearchFile(b).catch(() => false))) n++;
  }
  return n;
}
