/** Records made on the device (IndexedDB, their own ids) and kept in step with the server: highlights and bookmarks,
 *  review cards. The newest edit of a record wins; a deleted one stays as a tombstone so other devices learn of it. */
import type { Table } from 'dexie';
import { api } from '@/services/api';
import { isOnline } from '@/services/connectivity';
import { getPref, setPref } from '@/services/prefs';
import { dropRejected, rejectedForGood } from '@/services/syncQueue';

export interface SyncedRecord {
  id: string;
  client_updated_at: string;
  dirty?: 0 | 1; // changed here, not yet on the server
}

/** The sync of one table: push the changes made here, then pull the others' since the last pull. One sync at a
 *  time (a call while one runs gets that one). `path`: the API's collection; the reply lists the records under
 *  `listKey`, with a cursor for the next pull (kept under `cursorKey`). `onPulled` when something came in. */
export function syncedTable<T extends SyncedRecord>({ table, path, listKey, cursorKey, what, onPulled }: {
  table: Table<T, string>; path: string; listKey: string; cursorKey: string; what: string; onPulled: () => void;
}): () => Promise<void> {
  let syncing: Promise<void> | null = null;

  const push = async () => {
    for (const record of await table.where('dirty').equals(1).toArray()) {
      const { id, dirty: _, ...body } = record;
      let saved: T;
      try {
        saved = await api<T>(`${path}/${encodeURIComponent(id)}`, { method: 'PUT', body });
      } catch (e) {
        if (!rejectedForGood(e)) throw e;
        dropRejected(what, id, e);
        await table.update(id, (r) => { r.dirty = 0; }); // kept on this device, not sent again
        continue;
      }
      // changed again while it was on the way: it stays to be sent
      const now = await table.get(id);
      if (now && now.client_updated_at === record.client_updated_at) await table.put({ ...saved, dirty: 0 });
    }
  };

  const pull = async () => {
    const cursor = await getPref<string>(cursorKey);
    const res = await api<Record<string, unknown> & { cursor: string | null }>(
      `${path}${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`);
    const remotes = res[listKey] as T[];
    for (const remote of remotes) {
      const local = await table.get(remote.id);
      // the server's is newer, or the device has no change of its own that's newer
      if (!local || remote.client_updated_at > local.client_updated_at
        || (!local.dirty && local.client_updated_at <= remote.client_updated_at)) {
        await table.put({ ...remote, dirty: 0 });
      }
    }
    if (res.cursor) await setPref(cursorKey, res.cursor);
    if (remotes.length) onPulled();
  };

  return () => {
    if (!isOnline()) return Promise.resolve();
    syncing ??= (async () => {
      try {
        await push();
        await pull();
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  };
}
