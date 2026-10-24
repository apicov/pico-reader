/**
 * Web: dictionaries in IndexedDB, imported from the gzip'd JSON lines package.
 *
 * Entries are stored in blocks of a few hundred, sorted by their accent-free key (`fkey`), one IndexedDB row
 * per block: writing 100 000 single rows takes the browser minutes, a few hundred blocks take seconds. A
 * lookup finds the block whose first key is the last one ≤ the word and searches it in memory.
 */
import Dexie, { type Table } from 'dexie';
import { Gunzip } from 'fflate';
import type { Dictionary } from '@/services/types';
import type { DictBackend, DictEntry } from './store';
import { fold, keyOf } from './normalize';

/** Bump when the stored layout changes: dictionaries installed with an older one must be installed again */
export const WEB_STORE_VERSION = 3;

// [key, fkey, headword, definition, id]
type EntryItem = [string, string, string, string, number];
// [key, fkey, the entry's fkey, the entry's id]
type SynItem = [string, string, string, number];

interface Block {
  dictId: string;
  kind: 'e' | 's';
  first: string; // fkey of the first item
  items: EntryItem[] | SynItem[];
}

class DictDb extends Dexie {
  blocks!: Table<Block, number>;
  constructor() {
    // Relaxed durability: Chrome doesn't flush to disk after every write (an interrupted install is redone)
    super('pico-reader-dicts', { chromeTransactionDurability: 'relaxed' });
    this.version(1).stores({ entries: '[dictId+id], [dictId+key], [dictId+fkey]', syn: '++, [dictId+key], [dictId+fkey]' });
    this.version(2).stores({ entries: '[dictId+id], [dictId+fkey]', syn: '++, [dictId+fkey]' });
    this.version(3).stores({ entries: null, syn: null, blocks: '++, [dictId+kind+first]' });
  }
}

const db = new DictDb();
const ENTRY_BLOCK = 200;
const SYN_BLOCK = 1000;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

// Recently read blocks, so looking up several forms of a word reads each block once
const cache = new Map<string, Block[]>();
const CACHE_SIZE = 64;

/** The blocks that can hold `fkey`: the last block starting ≤ fkey, and earlier ones starting with the same key. */
async function blocksFor(dictId: string, kind: 'e' | 's', fkey: string): Promise<Block[]> {
  const cacheKey = `${dictId}\u0000${kind}\u0000${fkey}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const found = await db.blocks.where('[dictId+kind+first]')
    .between([dictId, kind, Dexie.minKey], [dictId, kind, fkey], true, true).reverse().limit(4).toArray();
  const out: Block[] = [];
  for (const block of found) {
    out.push(block);
    if (block.first < fkey) break; // blocks before this one end before fkey
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, out);
  return out;
}

async function entriesWith(dictId: string, fkey: string): Promise<EntryItem[]> {
  return (await blocksFor(dictId, 'e', fkey)).flatMap((b) => (b.items as EntryItem[]).filter((i) => i[1] === fkey));
}

export const webDictStore: DictBackend = {
  async install(dict: Dictionary, url, onProgress) {
    await this.remove(dict.id);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const entries: EntryItem[] = [];
    const syns: [string, number][] = [];
    let first = true;
    for await (const [line, fraction] of gzipLines(res, dict.files.jsonl!.size)) {
      if (first) { first = false; continue; } // {"name", "format"}
      const row = JSON.parse(line) as [number, string, string] | [string, number];
      if (row.length === 3) {
        const key = keyOf(row[1]);
        entries.push([key, fold(key), row[1], row[2], row[0]]);
      } else {
        syns.push([row[0], row[1]]);
      }
      if ((entries.length + syns.length) % 20000 === 0) onProgress(Math.min(0.9, fraction * 0.9));
    }
    const fkeyOf = new Map(entries.map((e) => [e[4], e[1]]));
    entries.sort((a, b) => cmp(a[1], b[1]));
    const synItems: SynItem[] = syns.filter(([, id]) => fkeyOf.has(id)).map(([word, id]) => {
      const key = keyOf(word);
      return [key, fold(key), fkeyOf.get(id)!, id];
    });
    synItems.sort((a, b) => cmp(a[1], b[1]));
    const blocks: Block[] = [];
    for (let i = 0; i < entries.length; i += ENTRY_BLOCK) {
      const items = entries.slice(i, i + ENTRY_BLOCK);
      blocks.push({ dictId: dict.id, kind: 'e', first: items[0][1], items });
    }
    for (let i = 0; i < synItems.length; i += SYN_BLOCK) {
      const items = synItems.slice(i, i + SYN_BLOCK);
      blocks.push({ dictId: dict.id, kind: 's', first: items[0][1], items });
    }
    for (let i = 0; i < blocks.length; i += 100) {
      await db.blocks.bulkAdd(blocks.slice(i, i + 100));
      onProgress(0.9 + 0.1 * Math.min(1, (i + 100) / blocks.length));
    }
    onProgress(1);
  },

  async remove(dictId) {
    for (const k of [...cache.keys()]) if (k.startsWith(`${dictId}\u0000`)) cache.delete(k);
    for (const kind of ['e', 's'] as const) {
      await db.blocks.where('[dictId+kind+first]').between([dictId, kind, Dexie.minKey], [dictId, kind, Dexie.maxKey]).delete();
    }
  },

  async lookup(dictId, keys, folded) {
    // Both kinds of lookup read by accent-free key; an exact one keeps the items whose key is asked for
    const fkeys = [...new Set(keys.map((k) => (folded ? k : fold(k))))];
    const field = folded ? 1 : 0;
    const wanted = new Set(keys);
    const ranked: { e: EntryItem; r: number }[] = [];
    for (const fkey of fkeys) {
      for (const e of await entriesWith(dictId, fkey)) {
        if (wanted.has(e[field])) ranked.push({ e, r: keys.indexOf(e[field]) });
      }
      const syns = (await blocksFor(dictId, 's', fkey)).flatMap((b) => (b.items as SynItem[]).filter((s) => s[1] === fkey));
      for (const s of syns.filter((s) => wanted.has(s[field]))) {
        const target = (await entriesWith(dictId, s[2])).find((e) => e[4] === s[3]);
        if (target) ranked.push({ e: target, r: keys.indexOf(s[field]) + 0.5 });
      }
    }
    ranked.sort((a, b) => a.r - b.r);
    const seen = new Set<number>();
    const out: DictEntry[] = [];
    for (const { e } of ranked) {
      if (!seen.has(e[4])) { seen.add(e[4]); out.push({ headword: e[2], def: e[3] }); }
    }
    return out;
  },

  async prefix(dictId, prefix, limit) {
    const start = await blocksFor(dictId, 'e', prefix);
    const blocks = [...[...start].reverse(), ...await db.blocks.where('[dictId+kind+first]')
      .between([dictId, 'e', prefix], [dictId, 'e', `${prefix}￿`], false, true).limit(2).toArray()];
    const out: string[] = [];
    for (const b of blocks) {
      for (const e of b.items as EntryItem[]) {
        if (e[1].startsWith(prefix) && !out.includes(e[2])) out.push(e[2]);
        if (out.length >= limit) return out;
      }
    }
    return out;
  },
};
