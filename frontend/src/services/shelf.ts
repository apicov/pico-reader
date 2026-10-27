/** The reader's own shelf in the shared library: reading / finished / removed, and apart from that "My shelf",
 *  the books they picked to keep in sight, grouped in collections (a book can be in several; adding it to one
 *  puts it on My shelf). Kept on the device for offline use; changes made offline are sent when the connection
 *  is back. */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import { dropRejected, rejectedForGood } from '@/services/syncQueue';

export type ShelfStatus = 'reading' | 'finished' | 'removed';

export interface ShelfEntry {
  book_id: string;
  status: ShelfStatus;
  progress: number;
  last_read: string | null;
}

export interface MyShelfEntry {
  book_id: string;
  added_at: string;
}

const KEY = 'shelf';
const PENDING = 'shelf_pending';
const MINE = 'my_shelf';
const MINE_PENDING = 'my_shelf_pending';
const COLLECTIONS = 'collections';
const COLLECTIONS_PENDING = 'collections_pending';

export interface Collection {
  id: string;
  name: string;
  position: number;
  book_ids: string[];
}

/** Collection changes, sent in the order they were made */
type CollectionOp =
  | { op: 'save'; id: string; name: string; position: number }
  | { op: 'delete'; id: string }
  | { op: 'add' | 'remove'; id: string; book_id: string };
const listeners = new Set<() => void>();

export function subscribeShelf(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function cachedShelf(): Promise<ShelfEntry[]> {
  return (await getPref<ShelfEntry[]>(KEY)) ?? [];
}

async function flush(): Promise<void> {
  const pending = (await getPref<Record<string, { status: ShelfStatus; only_if_new: boolean }>>(PENDING)) ?? {};
  for (const [bookId, body] of Object.entries(pending)) {
    await api(`/api/shelf/${encodeURIComponent(bookId)}`, { method: 'PUT', body }).catch((e) => {
      if (!rejectedForGood(e)) throw e; // e.g. the book was deleted meanwhile: dropped, the rest goes on
      dropRejected('shelf change for', bookId, e);
    });
    delete pending[bookId];
    await setPref(PENDING, pending);
  }
  const mine = (await getPref<Record<string, boolean>>(MINE_PENDING)) ?? {};
  for (const [bookId, on] of Object.entries(mine)) {
    await api(`/api/shelf/mine/${encodeURIComponent(bookId)}`, { method: on ? 'PUT' : 'DELETE' }).catch((e) => {
      if (!rejectedForGood(e)) throw e;
      dropRejected('My shelf change for', bookId, e);
    });
    delete mine[bookId];
    await setPref(MINE_PENDING, mine);
  }
  for (;;) {
    const ops = (await getPref<CollectionOp[]>(COLLECTIONS_PENDING)) ?? [];
    if (!ops.length) break;
    const o = ops[0];
    const base = `/api/shelf/collections/${encodeURIComponent(o.id)}`;
    const request = o.op === 'save' ? api(base, { method: 'PUT', body: { name: o.name, position: o.position } })
      : o.op === 'delete' ? api(base, { method: 'DELETE' })
      : api(`${base}/books/${encodeURIComponent(o.book_id)}`, { method: o.op === 'add' ? 'PUT' : 'DELETE' });
    await request.catch((e) => {
      if (!rejectedForGood(e)) throw e;
      dropRejected(`collection change (${o.op}) for`, o.id, e);
    });
    await setPref(COLLECTIONS_PENDING, ((await getPref<CollectionOp[]>(COLLECTIONS_PENDING)) ?? []).slice(1));
  }
}

export async function loadShelf(): Promise<ShelfEntry[]> {
  if (!isOnline()) return cachedShelf();
  try {
    await flush();
    const shelf = await api<ShelfEntry[]>('/api/shelf');
    await setPref(KEY, shelf);
    return shelf;
  } catch {
    return cachedShelf();
  }
}

/** `onlyIfNew`: opening a book starts it (or brings a removed one back); a finished book stays finished. */
export async function setShelfStatus(bookId: string, status: ShelfStatus, onlyIfNew = false): Promise<void> {
  const shelf = await cachedShelf();
  const entry = shelf.find((e) => e.book_id === bookId);
  if (entry && onlyIfNew && entry.status !== 'removed') return;
  const now = new Date().toISOString();
  if (entry) entry.status = status;
  else shelf.unshift({ book_id: bookId, status, progress: 0, last_read: now });
  await setPref(KEY, shelf);
  listeners.forEach((l) => l());
  const pending = (await getPref<Record<string, { status: ShelfStatus; only_if_new: boolean }>>(PENDING)) ?? {};
  pending[bookId] = { status, only_if_new: onlyIfNew };
  await setPref(PENDING, pending);
  if (isOnline()) void flush().catch(() => undefined);
}

export async function cachedMyShelf(): Promise<MyShelfEntry[]> {
  return (await getPref<MyShelfEntry[]>(MINE)) ?? [];
}

export async function loadMyShelf(): Promise<MyShelfEntry[]> {
  if (!isOnline()) return cachedMyShelf();
  try {
    await flush();
    const mine = await api<MyShelfEntry[]>('/api/shelf/mine');
    await setPref(MINE, mine);
    return mine;
  } catch {
    return cachedMyShelf();
  }
}

export async function setOnMyShelf(bookId: string, on: boolean): Promise<void> {
  const mine = (await cachedMyShelf()).filter((e) => e.book_id !== bookId);
  if (on) mine.unshift({ book_id: bookId, added_at: new Date().toISOString() });
  await setPref(MINE, mine);
  if (!on) {
    // off My shelf is out of its collections (the server does the same); a queued "add" would put it back
    await setPref(COLLECTIONS, (await cachedCollections()).map((c) => ({ ...c, book_ids: c.book_ids.filter((b) => b !== bookId) })));
    await setPref(COLLECTIONS_PENDING, ((await getPref<CollectionOp[]>(COLLECTIONS_PENDING)) ?? [])
      .filter((o) => !(o.op === 'add' && o.book_id === bookId)));
  }
  listeners.forEach((l) => l());
  const pending = (await getPref<Record<string, boolean>>(MINE_PENDING)) ?? {};
  pending[bookId] = on;
  await setPref(MINE_PENDING, pending);
  if (isOnline()) void flush().catch(() => undefined);
}

export async function cachedCollections(): Promise<Collection[]> {
  return (await getPref<Collection[]>(COLLECTIONS)) ?? [];
}

export async function loadCollections(): Promise<Collection[]> {
  if (!isOnline()) return cachedCollections();
  try {
    await flush();
    const collections = await api<Collection[]>('/api/shelf/collections');
    await setPref(COLLECTIONS, collections);
    return collections;
  } catch {
    return cachedCollections();
  }
}

/** Applied here at once (offline too) and queued for the server */
async function changeCollections(change: (cs: Collection[]) => Collection[], op: CollectionOp): Promise<void> {
  await setPref(COLLECTIONS, change(await cachedCollections()).sort((a, b) => a.position - b.position));
  await setPref(COLLECTIONS_PENDING, [...((await getPref<CollectionOp[]>(COLLECTIONS_PENDING)) ?? []), op]);
  listeners.forEach((l) => l());
  if (isOnline()) void flush().catch(() => undefined);
}

/** A new collection (at the end); returns its id */
export async function createCollection(name: string): Promise<string> {
  const id = `col-${crypto.randomUUID()}`;
  const position = Math.max(-1, ...(await cachedCollections()).map((c) => c.position)) + 1;
  await changeCollections((cs) => [...cs, { id, name: name.trim(), position, book_ids: [] }],
    { op: 'save', id, name: name.trim(), position });
  return id;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const c = (await cachedCollections()).find((x) => x.id === id);
  if (!c) return;
  await changeCollections((cs) => cs.map((x) => (x.id === id ? { ...x, name: name.trim() } : x)),
    { op: 'save', id, name: name.trim(), position: c.position });
}

/** Swaps a collection with its neighbour (`by` -1: up, 1: down) */
export async function moveCollection(id: string, by: -1 | 1): Promise<void> {
  const cs = await cachedCollections();
  const i = cs.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= cs.length) return;
  const [a, b] = [{ ...cs[i], position: cs[j].position }, { ...cs[j], position: cs[i].position }];
  if (a.position === b.position) a.position += by; // equal positions (older data): make them differ
  await changeCollections((all) => all.map((c) => (c.id === a.id ? a : c.id === b.id ? b : c)),
    { op: 'save', id: a.id, name: a.name, position: a.position });
  await changeCollections((all) => all, { op: 'save', id: b.id, name: b.name, position: b.position });
}

/** The books stay on My shelf */
export async function deleteCollection(id: string): Promise<void> {
  await changeCollections((cs) => cs.filter((c) => c.id !== id), { op: 'delete', id });
}

/** In or out of a collection; in also puts the book on My shelf */
export async function setInCollection(id: string, bookId: string, on: boolean): Promise<void> {
  if (on && !(await cachedMyShelf()).some((e) => e.book_id === bookId)) {
    await setPref(MINE, [{ book_id: bookId, added_at: new Date().toISOString() }, ...(await cachedMyShelf())]);
  }
  await changeCollections((cs) => cs.map((c) => (c.id !== id ? c : {
    ...c, book_ids: on ? [bookId, ...c.book_ids.filter((b) => b !== bookId)] : c.book_ids.filter((b) => b !== bookId) })),
  { op: on ? 'add' : 'remove', id, book_id: bookId });
}

/** My shelf in folders: each collection with its books in shelf order (`shelf`: the shelf's book ids, in order),
 *  and the books in no collection */
export function shelfFolders(collections: Collection[], shelf: string[]): { folders: { collection: Collection; books: string[] }[]; loose: string[] } {
  const inSome = new Set(collections.flatMap((c) => c.book_ids));
  return {
    folders: collections.map((c) => { const ids = new Set(c.book_ids); return { collection: c, books: shelf.filter((b) => ids.has(b)) }; }),
    loose: shelf.filter((b) => !inSome.has(b)),
  };
}
