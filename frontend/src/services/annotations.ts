/**
 * Highlights and bookmarks: made offline on the device (IndexedDB, own ids), pushed and pulled when online.
 * The newest edit of an annotation wins on the server; deleting leaves a tombstone so other devices learn of it.
 */
import Dexie, { type Table } from 'dexie';
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import { dropRejected, rejectedForGood } from '@/services/syncQueue';

export interface Annotation {
  id: string;
  book_id: string;
  kind: 'highlight' | 'bookmark';
  format: string;
  location: string;
  progress: number;
  text: string;
  note: string;
  color: string;
  deleted: boolean;
  client_updated_at: string;
  dirty?: 0 | 1; // changed here, not yet on the server
}

class AnnotationsDb extends Dexie {
  items!: Table<Annotation, string>;
  constructor() {
    super('pico-reader-annotations');
    this.version(1).stores({ items: 'id, book_id, dirty' });
  }
}

const db = new AnnotationsDb();
const MAX_TEXT = 5000; // what the server takes (routes/annotations.py)
const capped = <T extends { text?: string; note?: string }>(a: T): T => ({ ...a,
  ...(a.text !== undefined && { text: a.text.slice(0, MAX_TEXT) }), ...(a.note !== undefined && { note: a.note.slice(0, MAX_TEXT) }) });
const CURSOR = 'annotations_cursor';
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function subscribeAnnotations(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function annotationsFor(bookId: string): Promise<Annotation[]> {
  return (await db.items.where('book_id').equals(bookId).toArray())
    .filter((a) => !a.deleted).sort((a, b) => a.progress - b.progress);
}

export async function saveAnnotation(a: Omit<Annotation, 'id' | 'deleted' | 'client_updated_at' | 'note' | 'color'>
  & Partial<Pick<Annotation, 'id' | 'note' | 'color'>>): Promise<Annotation> {
  const full: Annotation = capped({ note: '', color: a.kind === 'highlight' ? 'yellow' : '', ...a,
    id: a.id ?? crypto.randomUUID(), deleted: false, client_updated_at: new Date().toISOString(), dirty: 1 });
  await db.items.put(full);
  changed();
  void syncAnnotations().catch(() => undefined);
  return full;
}

export async function updateAnnotation(id: string, patch: Partial<Pick<Annotation, 'note' | 'color' | 'deleted'>>): Promise<void> {
  const current = await db.items.get(id);
  if (!current) return;
  await db.items.put(capped({ ...current, ...patch, client_updated_at: new Date().toISOString(), dirty: 1 }));
  changed();
  void syncAnnotations().catch(() => undefined);
}

export const deleteAnnotation = (id: string) => updateAnnotation(id, { deleted: true });

let syncing: Promise<void> | null = null;

/** Push local changes, then pull the others' (one sync at a time). */
export function syncAnnotations(): Promise<void> {
  if (!isOnline()) return Promise.resolve();
  syncing ??= (async () => {
    try {
      for (const a of await db.items.where('dirty').equals(1).toArray()) {
        const { id, dirty: _, ...body } = a;
        let saved: Annotation;
        try {
          saved = await api<Annotation>(`/api/annotations/${encodeURIComponent(id)}`, { method: 'PUT', body });
        } catch (e) {
          if (!rejectedForGood(e)) throw e;
          dropRejected('highlight', id, e);
          await db.items.update(id, { dirty: 0 }); // kept on this device, not sent again
          continue;
        }
        const now = await db.items.get(id);
        // keep it dirty if it changed again meanwhile
        if (now && now.client_updated_at === a.client_updated_at) await db.items.put({ ...saved, dirty: 0 });
      }
      const cursor = await getPref<string>(CURSOR);
      const res = await api<{ annotations: Annotation[]; cursor: string | null }>(
        `/api/annotations${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`);
      for (const remote of res.annotations) {
        const local = await db.items.get(remote.id);
        if (!local || (!local.dirty && local.client_updated_at <= remote.client_updated_at) || remote.client_updated_at > local.client_updated_at) {
          await db.items.put({ ...remote, dirty: 0 });
        }
      }
      if (res.cursor) await setPref(CURSOR, res.cursor);
      if (res.annotations.length) changed();
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
