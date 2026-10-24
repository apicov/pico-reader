/**
 * Where each book is open. Saved on the device at once and synced to the server when online; the newest
 * stamp wins (the server keeps a newer position from another device and returns it).
 */
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';

export interface Position {
  book_id: string;
  format: string;
  location: string;
  progress: number; // 0..1 through the whole book
  updated_at: string;
}

const key = (bookId: string) => `position:${bookId}`;
const PENDING = 'positions_pending';

export async function localPosition(bookId: string): Promise<Position | null> {
  return getPref<Position>(key(bookId));
}

/** The newest of the device's and the server's position. */
export async function loadPosition(bookId: string): Promise<Position | null> {
  const local = await localPosition(bookId);
  if (!isOnline()) return local;
  try {
    await flushPositions();
    const remote = (await api<Position[]>('/api/progress')).find((p) => p.book_id === bookId) ?? null;
    if (remote && (!local || remote.updated_at > local.updated_at)) {
      await setPref(key(bookId), remote);
      return remote;
    }
  } catch {
    // offline or server trouble: the device's position will do
  }
  return local;
}

export async function savePosition(pos: Omit<Position, 'updated_at'>): Promise<void> {
  const full: Position = { ...pos, updated_at: new Date().toISOString() };
  await setPref(key(pos.book_id), full);
  const pending = (await getPref<Record<string, Position>>(PENDING)) ?? {};
  pending[pos.book_id] = full;
  await setPref(PENDING, pending);
}

/** Send positions saved while offline (or not yet sent). */
export async function flushPositions(): Promise<void> {
  const pending = (await getPref<Record<string, Position>>(PENDING)) ?? {};
  for (const [bookId, pos] of Object.entries(pending)) {
    await api('/api/progress', { method: 'PUT', body: pos });
    delete pending[bookId];
    await setPref(PENDING, pending);
  }
}
