/** Android: each dictionary is its own read-only SQLite database (`<id>SQLite.db`), built on the desktop. */
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { DictBackend, DictEntry } from './store';

const sqlite = new SQLiteConnection(CapacitorSQLite);
const open = new Map<string, Promise<SQLiteDBConnection>>();

async function connection(dictId: string): Promise<SQLiteDBConnection> {
  let conn = open.get(dictId);
  if (!conn) {
    conn = (async () => {
      const exists = (await sqlite.isConnection(dictId, true)).result;
      const db = exists ? await sqlite.retrieveConnection(dictId, true)
        : await sqlite.createConnection(dictId, false, 'no-encryption', 1, true);
      await db.open();
      return db;
    })();
    open.set(dictId, conn);
    conn.catch(() => open.delete(dictId));
  }
  return conn;
}

async function close(dictId: string): Promise<void> {
  if (!open.has(dictId)) return;
  open.delete(dictId);
  await sqlite.closeConnection(dictId, true).catch(() => undefined);
}

export const nativeDictStore: DictBackend = {
  async install(_dict, url, onProgress) {
    await close(_dict.id);
    // The plugin downloads the zip, unzips <id>SQLite.db into its database folder (no progress events)
    await sqlite.getFromHTTPRequest(url, true);
    onProgress(1);
  },

  async remove(dictId) {
    await close(dictId);
    await CapacitorSQLite.deleteDatabase({ database: dictId, readonly: false } as never).catch(async () => {
      const db = await sqlite.createConnection(dictId, false, 'no-encryption', 1, false);
      await db.open();
      await db.delete();
      await sqlite.closeConnection(dictId, false).catch(() => undefined);
    });
  },

  async lookup(dictId, keys, folded) {
    if (keys.length === 0) return [];
    const db = await connection(dictId);
    const col = folded ? 'fkey' : 'key';
    const marks = keys.map(() => '?').join(',');
    // rank by the position of the matching key in `keys`; synonyms just after direct matches
    const order = `CASE k ${keys.map((_, i) => `WHEN ? THEN ${i}`).join(' ')} END`;
    const res = await db.query(`
      SELECT id, headword, def, MIN(${order} * 2 + syn) AS rank FROM (
        SELECT e.id, e.headword, e.def, e.${col} AS k, 0 AS syn FROM entries e WHERE e.${col} IN (${marks})
        UNION ALL
        SELECT e.id, e.headword, e.def, s.${col} AS k, 1 AS syn FROM syn s JOIN entries e ON e.id = s.entry_id
          WHERE s.${col} IN (${marks})
      ) GROUP BY id ORDER BY rank LIMIT 30`, [...keys, ...keys, ...keys]);
    return (res.values ?? []).map((r) => ({ headword: r.headword as string, def: r.def as string })) as DictEntry[];
  },

  async prefix(dictId, prefix, limit) {
    const db = await connection(dictId);
    const res = await db.query('SELECT DISTINCT headword FROM entries WHERE fkey >= ? AND fkey < ? LIMIT ?',
      [prefix, prefix + '￿', limit]);
    return (res.values ?? []).map((r) => r.headword as string);
  },
};
