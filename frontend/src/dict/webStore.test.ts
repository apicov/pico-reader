import 'fake-indexeddb/auto';
import { gzipSync, strToU8 } from 'fflate';
import type { Dictionary } from '@/services/types';
import { webDictStore } from './webStore';

const LINES = [
  { name: 'Test', format: 1 },
  [0, 'Haus', 'das; -es, Häuser'],
  [1, 'Straße', 'die; -, -n'],
  [2, 'grün', 'Farbe'],
  ['Häuser', 0], // synonym → entry 0
];

function dict(size: number): Dictionary {
  return { id: 'test-de', name: 'Test', from_lang: 'de', to_lang: 'de', entry_count: 3, updated_at: '',
    files: { jsonl: { size, sha256: 'x' } } };
}

beforeAll(async () => {
  const gz = gzipSync(strToU8(LINES.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(gz))) as typeof fetch;
  const progress: number[] = [];
  await webDictStore.install(dict(gz.length), 'https://r2/x', (f) => progress.push(f));
  expect(progress[progress.length - 1]).toBe(1);
});

describe('webDictStore', () => {
  it('finds a headword by its exact key, ß intact', async () => {
    expect((await webDictStore.lookup('test-de', ['straße'], false)).map((e) => e.headword)).toEqual(['Straße']);
    expect(await webDictStore.lookup('test-de', ['strasse'], false)).toEqual([]);
  });

  it('finds through synonyms, the earlier key first', async () => {
    const found = await webDictStore.lookup('test-de', ['häuser', 'haus'], false);
    expect(found.map((e) => e.headword)).toEqual(['Haus']);
  });

  it('folded lookup ignores accents', async () => {
    expect((await webDictStore.lookup('test-de', ['grun'], true)).map((e) => e.headword)).toEqual(['grün']);
  });

  it('prefix suggestions', async () => {
    expect(await webDictStore.prefix('test-de', 'str', 5)).toEqual(['Straße']);
  });

  it('removes everything of the dictionary', async () => {
    await webDictStore.remove('test-de');
    expect(await webDictStore.lookup('test-de', ['haus'], false)).toEqual([]);
  });
});

describe('webDictStore with many entries', () => {
  it('finds words in every block, also when equal keys span two blocks', async () => {
    const words = Array.from({ length: 1000 }, (_, i) => `wort${String(i).padStart(4, '0')}`);
    // 6 entries with the same key around the first block boundary (200 per block)
    const lines: unknown[] = [{ name: 'Big', format: 1 }, ...words.map((w, i) => [i, w, `def ${w}`])];
    for (let i = 0; i < 6; i++) lines.push([1000 + i, 'wort0199', `extra ${i}`]);
    lines.push(['Synonym', 500]);
    const gz = gzipSync(strToU8(lines.map((l) => JSON.stringify(l)).join('\n')));
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(gz))) as typeof fetch;
    const big: Dictionary = { id: 'big', name: 'Big', from_lang: 'de', to_lang: 'de', entry_count: 1006, updated_at: '',
      files: { jsonl: { size: gz.length, sha256: 'x' } } };
    await webDictStore.install(big, 'https://r2/big', () => undefined);
    for (const w of ['wort0000', 'wort0400', 'wort0999']) {
      expect((await webDictStore.lookup('big', [w], false)).map((e) => e.headword)).toEqual([w]);
    }
    expect(await webDictStore.lookup('big', ['wort0199'], false)).toHaveLength(7);
    expect((await webDictStore.lookup('big', ['synonym'], false))[0].def).toBe('def wort0500');
    expect(await webDictStore.prefix('big', 'wort05', 3)).toEqual(['wort0500', 'wort0501', 'wort0502']);
  });
});
