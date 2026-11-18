/**
 * Workspaces: named sets of books open at the same time, shown as tabs in the reader (docs/18-workspaces.md).
 * The workspaces (names and books) are the account's: kept on the device for offline use, changes sent later, and
 * the newest change to a workspace wins. Which workspace is open, and which tab is in front, are this device's.
 */
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref, updatePref } from '@/services/prefs';
import { dropRejected, rejectedForGood } from '@/services/syncQueue';
import { createSignal } from '@/utils/signal';

export interface Workspace {
  id: string;
  name: string;
  book_ids: string[];
  position: number;
  updated_at: string;
  /** Deleted here and not sent yet (the server keeps it as a tombstone) */
  deleted?: boolean;
}

export const MAX_BOOKS = 8;
export const DEFAULT_NAME = 'Reading';

const KEY = 'workspaces';
const PENDING = 'workspaces_pending'; // ids whose latest state the server hasn't had yet
const CURRENT = 'workspace_current';
const FRONT = 'workspace_front:';
const WAS_OPEN = 'reader_was_open';

const changes = createSignal();
export const subscribeWorkspaces = changes.subscribe;

async function all(): Promise<Workspace[]> {
  return (await getPref<Workspace[]>(KEY)) ?? [];
}

export async function workspaces(): Promise<Workspace[]> {
  return (await all()).filter((w) => !w.deleted).sort((a, b) => a.position - b.position);
}

const time = (w: Workspace) => Date.parse(w.updated_at) || 0;

/** The server's list and this device's: per workspace the newer one (an unsent change is always newer). One the
 *  server doesn't have was deleted elsewhere, unless it's new here and not sent yet. `resend`: newer here but not
 *  queued (changed while it was being sent), so it goes again. */
export function merge(local: Workspace[], remote: Workspace[], pending: string[]): { list: Workspace[]; resend: string[] } {
  const resend: string[] = [];
  const list = remote.map((r) => {
    const l = local.find((x) => x.id === r.id);
    if (!l || !(pending.includes(l.id) || time(l) > time(r))) return r;
    if (!pending.includes(l.id)) resend.push(l.id);
    return l;
  });
  list.push(...local.filter((l) => pending.includes(l.id) && !remote.some((r) => r.id === l.id)));
  return { list, resend };
}

async function save(w: Workspace): Promise<void> {
  const changed = { ...w, updated_at: new Date().toISOString() };
  await updatePref<Workspace[]>(KEY, (list) => [...(list ?? []).filter((x) => x.id !== w.id), changed]);
  await queue([w.id]);
  changes.emit();
  if (isOnline()) void flush().catch(() => undefined);
}

const queue = (ids: string[]) => updatePref<string[]>(PENDING, (q) => [...new Set([...(q ?? []), ...ids])]);

let flushing: Promise<void> | null = null;

/** Sends each queued workspace's latest state. The server answers with the time it kept (a device clock ahead of
 *  it is clamped), which the device takes, unless the workspace changed again meanwhile: then it goes again. */
function flush(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (;;) {
        const [id] = (await getPref<string[]>(PENDING)) ?? [];
        if (!id) return;
        const w = (await all()).find((x) => x.id === id);
        await updatePref<string[]>(PENDING, (q) => (q ?? []).filter((x) => x !== id));
        if (!w) continue;
        try {
          const kept = await api<Workspace>(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'PUT',
            body: { name: w.name, book_ids: w.book_ids, position: w.position, updated_at: w.updated_at, deleted: !!w.deleted } });
          await updatePref<Workspace[]>(KEY, (list) => (list ?? []).flatMap((x) => {
            if (x.id !== id || x.updated_at !== w.updated_at) return [x]; // changed meanwhile: queued by save
            return w.deleted ? [] : [{ ...x, updated_at: kept.updated_at }];
          }));
        } catch (e) {
          if (!rejectedForGood(e)) { await queue([id]); throw e; }
          dropRejected('workspace', id, e);
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** At start, every few minutes and when the connection is back: send this device's changes, then take the account's. */
export async function syncWorkspaces(): Promise<void> {
  if (!isOnline()) return;
  try {
    await flush();
    const remote = await api<Workspace[]>('/api/workspaces');
    const before = JSON.stringify(await all());
    const pending = (await getPref<string[]>(PENDING)) ?? [];
    let resend: string[] = [];
    await updatePref<Workspace[]>(KEY, (local) => {
      const merged = merge(local ?? [], remote, pending);
      resend = merged.resend;
      return merged.list;
    });
    if (resend.length) { await queue(resend); void flush().catch(() => undefined); }
    if (JSON.stringify(await all()) !== before) changes.emit();
  } catch {
    /* offline or the server is down: the device's copy stays */
  }
}

/** The workspace open on this device: the one picked here, else the first; a new "Reading" one when there's none. */
export async function currentWorkspace(): Promise<Workspace> {
  // a device with none yet (just signed in) takes the account's first, rather than making another "Reading"
  if (!(await all()).length) await syncWorkspaces();
  const list = await workspaces();
  const id = await getPref<string>(CURRENT);
  const found = list.find((w) => w.id === id) ?? list[0];
  if (found) {
    if (found.id !== id) await setPref(CURRENT, found.id);
    return found;
  }
  const w: Workspace = { id: `ws-${crypto.randomUUID()}`, name: DEFAULT_NAME, book_ids: [], position: 0, updated_at: '' };
  await setPref(CURRENT, w.id);
  await save(w);
  return w;
}

/** The tab in front in a workspace on this device (its first book when none was picked, or it was closed) */
export async function frontBook(w: Workspace): Promise<string | null> {
  const id = await getPref<string>(FRONT + w.id);
  return id && w.book_ids.includes(id) ? id : w.book_ids[0] ?? null;
}

/** A book opened (or switched to): a tab in the current workspace, in front. A full workspace gives up its leftmost
 *  tab other than the one in front. */
export async function openInWorkspace(bookId: string): Promise<void> {
  const w = await currentWorkspace();
  if (!w.book_ids.includes(bookId)) {
    let books = w.book_ids;
    if (books.length >= MAX_BOOKS) {
      const front = await frontBook(w);
      const drop = books.find((b) => b !== front);
      books = books.filter((b) => b !== drop);
    }
    await save({ ...w, book_ids: [...books, bookId] });
  }
  if ((await getPref<string>(FRONT + w.id)) !== bookId) {
    await setPref(FRONT + w.id, bookId);
    changes.emit();
  }
}

/** Closes a tab of the current workspace; returns the book now in front (its neighbour), or null when none is left. */
export async function closeTab(bookId: string): Promise<string | null> {
  const w = await currentWorkspace();
  const i = w.book_ids.indexOf(bookId);
  if (i < 0) return frontBook(w);
  const books = w.book_ids.filter((b) => b !== bookId);
  const front = await frontBook(w);
  const next = front && front !== bookId ? front : books[Math.min(i, books.length - 1)] ?? null;
  await setPref(FRONT + w.id, next);
  await save({ ...w, book_ids: books });
  return next;
}

/** A new workspace, open at once; it starts with `firstBook` (the book being read), if given. Returns its id. */
export async function createWorkspace(name: string, firstBook?: string): Promise<string> {
  const id = `ws-${crypto.randomUUID()}`;
  const position = Math.max(-1, ...(await workspaces()).map((w) => w.position)) + 1;
  await setPref(CURRENT, id);
  if (firstBook) await setPref(FRONT + id, firstBook);
  await save({ id, name: name.trim(), book_ids: firstBook ? [firstBook] : [], position, updated_at: '' });
  return id;
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const w = (await workspaces()).find((x) => x.id === id);
  if (w) await save({ ...w, name: name.trim() });
}

/** The books aren't touched. Another workspace (or a new "Reading" one) becomes the current one. */
export async function deleteWorkspace(id: string): Promise<void> {
  const w = (await workspaces()).find((x) => x.id === id);
  if (!w) return;
  await save({ ...w, deleted: true });
  await setPref(FRONT + id, null);
  if ((await getPref<string>(CURRENT)) === id) await setPref(CURRENT, null);
}

/** Opens another workspace on this device; returns its book in front (null: it has none) */
export async function switchWorkspace(id: string): Promise<string | null> {
  await setPref(CURRENT, id);
  changes.emit();
  return frontBook(await currentWorkspace());
}

/** Whether the app was left in a book: it opens there again at the next start */
export const setReaderOpen = (open: boolean) => setPref(WAS_OPEN, open);
export const readerWasOpen = async () => (await getPref<boolean>(WAS_OPEN)) ?? false;

/** The workspaces, the current one and its tab in front, kept up to date */
export function useWorkspaces(): { list: Workspace[]; current: Workspace | null; front: string | null } {
  const [state, setState] = useState<{ list: Workspace[]; current: Workspace | null; front: string | null }>(
    { list: [], current: null, front: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await workspaces();
      const id = await getPref<string>(CURRENT);
      const current = list.find((w) => w.id === id) ?? list[0] ?? null;
      const front = current ? await frontBook(current) : null;
      if (alive) setState({ list, current, front });
    };
    void load();
    const unsubscribe = changes.subscribe(() => void load());
    return () => { alive = false; unsubscribe(); };
  }, []);
  return state;
}
