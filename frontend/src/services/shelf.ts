/** The reader's own shelf in the shared library: reading / finished / removed, and apart from that "My shelf",
 *  the books they picked to keep in sight. Kept on the device for offline use; changes made offline are sent when
 *  the connection is back. */
import { api, ApiError } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

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
    await api(`/api/shelf/${encodeURIComponent(bookId)}`, { method: 'PUT', body });
    delete pending[bookId];
    await setPref(PENDING, pending);
  }
  const mine = (await getPref<Record<string, boolean>>(MINE_PENDING)) ?? {};
  for (const [bookId, on] of Object.entries(mine)) {
    await api(`/api/shelf/mine/${encodeURIComponent(bookId)}`, { method: on ? 'PUT' : 'DELETE' }).catch((e) => {
      if (!(e instanceof ApiError && e.status === 404)) throw e; // the book was deleted meanwhile
    });
    delete mine[bookId];
    await setPref(MINE_PENDING, mine);
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
  listeners.forEach((l) => l());
  const pending = (await getPref<Record<string, boolean>>(MINE_PENDING)) ?? {};
  pending[bookId] = on;
  await setPref(MINE_PENDING, pending);
  if (isOnline()) void flush().catch(() => undefined);
}
