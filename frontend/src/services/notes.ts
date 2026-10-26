/**
 * The reader's notes (summaries, outlines, Mermaid diagrams), written by the chat agent on request or by hand.
 * The server keeps them; the device keeps a copy (IndexedDB) so notes read offline. Changing one needs a
 * connection.
 */
import Dexie, { type Table } from 'dexie';
import { api, ApiError } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import type { Passage } from '@/services/chat';

export interface Note {
  id: string;
  title: string;
  markdown: string;
  book_id: string | null;
  book_title: string | null;
  sources: Passage[]; // what the note's [n] citations point to
  project_id?: string | null; // a project on the study computer: the note's file is in its notes/ folder
  project?: string | null; // its name
  created_at: string;
  updated_at: string;
}

class NotesDb extends Dexie {
  notes!: Table<Note, string>;
  constructor() {
    super('notes');
    this.version(1).stores({ notes: 'id, updated_at, book_id' });
  }
}

const db = new NotesDb();
const listeners = new Set<() => void>();

export function subscribeNotes(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const changed = () => listeners.forEach((l) => l());

export async function cachedNotes(bookId?: string): Promise<Note[]> {
  const all = await db.notes.orderBy('updated_at').reverse().toArray();
  return bookId ? all.filter((n) => n.book_id === bookId) : all;
}

/** All the reader's notes, fresh from the server when online (and kept on the device). */
export async function loadNotes(): Promise<Note[]> {
  if (!isOnline()) return cachedNotes();
  try {
    const notes = await api<Note[]>('/api/notes');
    await db.transaction('rw', db.notes, async () => {
      await db.notes.clear();
      await db.notes.bulkPut(notes);
    });
    return notes;
  } catch {
    return cachedNotes();
  }
}

export async function getNote(id: string): Promise<Note | undefined> {
  if (isOnline()) {
    try {
      const note = await api<Note>(`/api/notes/${encodeURIComponent(id)}`);
      await db.notes.put(note);
      return note;
    } catch {
      // fall back to the copy on the device
    }
  }
  return db.notes.get(id);
}

/** The note changed elsewhere (e.g. its file on the computer) since this edit began: `current` is that version. */
export class NoteConflict extends Error {
  constructor(public current: Note) {
    super('This note changed meanwhile');
  }
}

/** `editedFrom`: the note's updated_at when the edit began; a newer version on the server is a NoteConflict. */
export async function changeNote(id: string, patch: { title?: string; markdown?: string; project_id?: string | null },
                                 editedFrom?: string): Promise<Note> {
  let note: Note;
  try {
    note = await api<Note>(`/api/notes/${encodeURIComponent(id)}`, { method: 'PATCH',
      body: editedFrom ? { ...patch, updated_at_was: editedFrom } : patch });
  } catch (e) {
    const current = e instanceof ApiError && e.status === 409 ? await getNote(id) : undefined;
    throw current ? new NoteConflict(current) : e;
  }
  await db.notes.put(note);
  changed();
  return note;
}

export async function deleteNote(id: string): Promise<void> {
  await api(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await db.notes.delete(id);
  changed();
}
