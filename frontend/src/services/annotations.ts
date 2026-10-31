/**
 * Highlights and bookmarks: made offline on the device (IndexedDB, own ids), pushed and pulled when online.
 * The newest edit of an annotation wins on the server; deleting leaves a tombstone so other devices learn of it.
 */
import Dexie, { type Table } from 'dexie';
import { syncedTable } from '@/services/syncedTable';
import { createSignal } from '@/utils/signal';

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
  dirty?: 0 | 1; // changed here, not yet on the server (syncedTable)
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
const changes = createSignal();
const changed = () => changes.emit();

export const subscribeAnnotations = changes.subscribe;

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

/** Push local changes, then pull the others' (one sync at a time). */
export const syncAnnotations = syncedTable<Annotation>({ table: db.items, path: '/api/annotations', listKey: 'annotations',
  cursorKey: CURSOR, what: 'highlight', onPulled: changed });
