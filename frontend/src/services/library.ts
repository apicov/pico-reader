/** The library manifest (books + dictionaries), cached so the list shows offline. */
import { api, NOT_MODIFIED } from '@/services/api';
import { getPref, setPref } from '@/services/prefs';
import type { Library } from '@/services/types';

const KEY = 'library_manifest';
// Cover links are signed for an hour; past this age a 304 isn't enough, the links need re-signing
const COVER_LINKS_MAX_AGE_MS = 45 * 60 * 1000;

interface Cached {
  library: Library;
  etag: string;
  fetchedAt: number;
}

export async function cachedLibrary(): Promise<Library | null> {
  return (await getPref<Cached>(KEY))?.library ?? null;
}

/** The server's library, or the cached one when nothing changed. Throws when the server can't be reached. */
export async function fetchLibrary(): Promise<Library> {
  const cached = await getPref<Cached>(KEY);
  const fresh = cached && Date.now() - cached.fetchedAt < COVER_LINKS_MAX_AGE_MS;
  let etag = '';
  const res = await api<Library | typeof NOT_MODIFIED>('/api/library', {
    etag: fresh ? cached.etag : undefined,
    onEtag: (t) => { etag = t; },
  });
  if (res === NOT_MODIFIED && cached) return cached.library;
  const library = res as Library;
  await setPref(KEY, { library, etag, fetchedAt: Date.now() } satisfies Cached);
  return library;
}
