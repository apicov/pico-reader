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
