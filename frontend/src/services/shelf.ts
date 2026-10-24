/** The reader's own shelf in the shared library: reading / finished / removed. Kept on the device for offline
 *  use; changes made offline are sent when the connection is back. */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

export type ShelfStatus = 'reading' | 'finished' | 'removed';

export interface ShelfEntry {
  book_id: string;
  status: ShelfStatus;
  progress: number;
  last_read: string | null;
}

const KEY = 'shelf';
const PENDING = 'shelf_pending';
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
