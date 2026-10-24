/**
 * Translations of selected passages (Groq, through the backend). The server keeps them all; the device keeps
 * a copy (IndexedDB) so the history reads offline, synced by id.
 */
import Dexie, { type Table } from 'dexie';
import { api } from '@/services/api';

export interface Translation {
  id: number;
  book_id: string | null;
  location: string;
  source_text: string;
  context: string;
  source_lang: string;
  target_lang: string;
  translation: string;
  notes: string;
  vocabulary: { term: string; meaning: string }[];
  model: string;
  created_at: string;
  cached?: boolean;
}

class TranslationsDb extends Dexie {
  items!: Table<Translation, number>;
  constructor() {
    super('pico-reader-translations');
    this.version(1).stores({ items: 'id, book_id, created_at' });
  }
}

const db = new TranslationsDb();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function subscribeTranslations(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function translate(req: {
  text: string; context: string; source_lang: string; target_lang: string; book_id: string; location: string;
}): Promise<Translation> {
  const t = await api<Translation>('/api/translate', { method: 'POST', body: req });
  await db.items.put(t);
  changed();
  return t;
}

/** A translation of this passage already on the device */
export async function findLocal(text: string, target: string): Promise<Translation | undefined> {
  return db.items.filter((t) => t.source_text === text && t.target_lang === target).last();
}

export async function localTranslations(bookId?: string): Promise<Translation[]> {
  const all = bookId ? await db.items.where('book_id').equals(bookId).toArray() : await db.items.toArray();
  return all.sort((a, b) => b.id - a.id);
}

/** Fetch translations made on other devices (newer than the newest one here). */
export async function syncTranslations(): Promise<void> {
  const newest = (await db.items.orderBy('id').last())?.id ?? 0;
  const fresh = await api<Translation[]>(`/api/translations?since_id=${newest}&limit=2000`);
  if (fresh.length) {
    await db.items.bulkPut(fresh);
    changed();
  }
}

export async function deleteTranslation(id: number): Promise<void> {
  await api(`/api/translations/${id}`, { method: 'DELETE' });
  await db.items.delete(id);
  changed();
}
