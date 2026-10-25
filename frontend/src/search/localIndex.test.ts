import { gzipSync, strToU8 } from 'fflate';
import type { Book } from '@/services/types';
import { searchOffline } from './localIndex';

// a tiny search file: 3 passages, 2-dimensional vectors stored as float16 (1.0 = 0x3c00)
const halves = new Uint16Array([0x3c00, 0, 0, 0x3c00, 0, 0]);
const file = {
  dimensions: 2, text_format: 'epub',
  passages: [
    { location: 'l0', progress: 0.1, heading: 'Kapitel 1', text: 'Der Alarm kam am Vormittag.' },
    { location: 'l1', progress: 0.5, heading: 'Kapitel 9', text: 'Die Haare gingen ihr aus.' },
    { location: 'l2', progress: 0.9, heading: 'Kapitel 12', text: 'Alarm, Haare, Hamburg.' },
  ],
  vectors: btoa(String.fromCharCode(...new Uint8Array(halves.buffer))),
};
vi.mock('@/services/bookCache', () => ({
  fileBlob: vi.fn(async () => new Blob([gzipSync(strToU8(JSON.stringify(file))) as BlobPart])),
}));
const embed = vi.hoisted(() => vi.fn(async () => [new Float32Array([0, 1])]));
vi.mock('./localModel', () => ({ embedTexts: embed }));

const book = { id: 'b1', title: 'Die Wolke', search: { size: 1, sha256: 's'.repeat(64) } } as unknown as Book;

describe('offline search', () => {
  it('ranks by meaning and words together', async () => {
    const found = await searchOffline('Haare', [book]);
    expect(found[0].location).toBe('l1'); // closest vector and the word
    expect(found.map((p) => p.location)).toContain('l2'); // the word only
    expect(found[0]).toMatchObject({ book_id: 'b1', title: 'Die Wolke', heading: 'Kapitel 9', format: 'epub' });
  });

  it('without the model, matches words only and never calls it', async () => {
    embed.mockClear();
    const found = await searchOffline('alarm', [book], true);
    expect(embed).not.toHaveBeenCalled();
    expect(found.map((p) => p.location).sort()).toEqual(['l0', 'l2']);
  });

  it('accents and case don\'t matter for words', async () => {
    const found = await searchOffline('HÄARE', [book], true);
    expect(found.map((p) => p.location).sort()).toEqual(['l1', 'l2']);
  });
});
