/** Web: entries and synonyms in IndexedDB (Dexie), imported from the gzip'd JSON lines package. */
import Dexie, { type Table } from 'dexie';
import { Gunzip } from 'fflate';
import type { Dictionary } from '@/services/types';
import type { DictBackend, DictEntry } from './store';
import { fold, keyOf } from './normalize';

interface EntryRow { dictId: string; id: number; headword: string; key: string; fkey: string; def: string }
interface SynRow { dictId: string; key: string; fkey: string; entryId: number }

class DictDb extends Dexie {
  entries!: Table<EntryRow, [string, number]>;
  syn!: Table<SynRow, number>;
  constructor() {
    // Relaxed durability: Chrome doesn't flush to disk after every batch (an interrupted install is redone)
    super('pico-reader-dicts', { chromeTransactionDurability: 'relaxed' });
    this.version(1).stores({
      entries: '[dictId+id], [dictId+key], [dictId+fkey]',
      syn: '++, [dictId+key], [dictId+fkey]',
    });
    // One lookup index instead of two: exact matches are the accent-free matches filtered by `key`.
    // Each index costs a write per row, and this halves the install time.
    this.version(2).stores({
      entries: '[dictId+id], [dictId+fkey]',
      syn: '++, [dictId+fkey]',
    });
  }
}

const db = new DictDb();
const BATCH = 20000;

/** Lines of a gzip'd text download, with the share of compressed bytes read so far (fflate's streaming
 *  gunzip: DecompressionStream is missing from older browsers). */
async function* gzipLines(res: Response, size: number): AsyncGenerator<[string, number]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let buffer = '';
  const gunzip = new Gunzip((chunk) => { buffer += decoder.decode(chunk, { stream: true }); });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { gunzip.push(new Uint8Array(0), true); buffer += decoder.decode(); }
    else { read += value.length; gunzip.push(value); }
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line) yield [line, read / size];
    if (done) break;
  }
  if (buffer) yield [buffer, 1];
}

export const webDictStore: DictBackend = {
  async install(dict: Dictionary, url, onProgress) {
    await this.remove(dict.id);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    let entries: EntryRow[] = [];
    let syns: SynRow[] = [];
    let first = true;
    for await (const [line, fraction] of gzipLines(res, dict.files.jsonl!.size)) {
      if (first) { first = false; continue; } // {"name", "format"}
      const row = JSON.parse(line) as [number, string, string] | [string, number];
      if (row.length === 3) {
        const key = keyOf(row[1]);
        entries.push({ dictId: dict.id, id: row[0], headword: row[1], key, fkey: fold(key), def: row[2] });
      } else {
        const key = keyOf(row[0]);
        syns.push({ dictId: dict.id, key, fkey: fold(key), entryId: row[1] });
      }
      if (entries.length + syns.length >= BATCH) {
        await db.transaction('rw', db.entries, db.syn, async () => { await db.entries.bulkAdd(entries); await db.syn.bulkAdd(syns); });
        entries = [];
        syns = [];
        onProgress(Math.min(0.99, fraction));
      }
    }
    await db.transaction('rw', db.entries, db.syn, async () => { await db.entries.bulkAdd(entries); await db.syn.bulkAdd(syns); });
    onProgress(1);
  },

  async remove(dictId) {
    await db.entries.where('[dictId+id]').between([dictId, Dexie.minKey], [dictId, Dexie.maxKey]).delete();
    await db.syn.where('[dictId+fkey]').between([dictId, Dexie.minKey], [dictId, Dexie.maxKey]).delete();
  },

  async lookup(dictId, keys, folded) {
    // Both kinds go through the accent-free index; an exact lookup keeps the rows whose key is asked for
    const pairs = [...new Set(keys.map((k) => (folded ? k : fold(k))))].map((k) => [dictId, k]);
    const field = folded ? 'fkey' : 'key';
    const wanted = new Set(keys);
    const [direct, viaSyn] = await Promise.all([
      db.entries.where('[dictId+fkey]').anyOf(pairs).toArray(),
      db.syn.where('[dictId+fkey]').anyOf(pairs).toArray(),
    ]);
    const hits = direct.filter((e) => wanted.has(e[field]));
    const synHits = viaSyn.filter((s) => wanted.has(s[field]));
    const synEntries = synHits.length
      ? (await db.entries.bulkGet(synHits.map((s) => [dictId, s.entryId] as [string, number]))).filter((e): e is EntryRow => !!e)
      : [];
    const rank = (k: string) => keys.indexOf(k);
    const ranked = [
      ...hits.map((e) => ({ e, r: rank(e[field]) })),
      ...synEntries.map((e, i) => ({ e, r: rank(synHits[i][field]) + 0.5 })),
    ].sort((a, b) => a.r - b.r);
    const seen = new Set<number>();
    const out: DictEntry[] = [];
    for (const { e } of ranked) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push({ headword: e.headword, def: e.def }); }
    }
    return out;
  },

  async prefix(dictId, prefix, limit) {
    const rows = await db.entries.where('[dictId+fkey]')
      .between([dictId, prefix], [dictId, prefix + '￿']).limit(limit).toArray();
    return [...new Set(rows.map((r) => r.headword))];
  },
};
