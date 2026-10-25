import 'fake-indexeddb/auto';
import type { Book } from '@/services/types';
import { cachedFiles, ensureCover, ensureFile, fileBlob, isCached } from './index';

vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string) => ({ url: `https://r2.example${path}` })),
}));

let downloads = 0;
beforeEach(() => {
  localStorage.clear();
  downloads = 0;
  globalThis.fetch = vi.fn(async () => {
    downloads++;
    await new Promise((r) => setTimeout(r, 20)); // still downloading when the second request comes
    return new Response('%PDF-1.4 book', { headers: { 'Content-Type': 'application/pdf' } });
  }) as typeof fetch;
});

const book = (sha = 'a'.repeat(64)): Book => ({
  id: 'b1', title: 'T', author: '', language: 'de', updated_at: '', can_change: false, category_id: null,
  category2_id: null, category_reason: '', formats: { pdf: { size: 13, sha256: sha } }, search: null,
  cover: { size: 13, sha256: 'c'.repeat(64), url: 'https://r2.example/cover' }, index: null,
} as unknown as Book);

describe('book cache', () => {
  it('two requests for the same file share one download', async () => {
    await Promise.all([ensureFile(book(), 'pdf'), ensureFile(book(), 'pdf')]);
    expect(downloads).toBe(1);
    expect(await (await fileBlob('b1', 'pdf')).text()).toBe('%PDF-1.4 book');
    await Promise.all([ensureCover(book()), ensureCover(book())]);
    expect(downloads).toBe(2);
  });

  it('a file already here is not downloaded again; a replaced one is', async () => {
    await ensureFile(book(), 'pdf');
    expect(downloads).toBe(0);
    expect(await isCached('b1', 'pdf', book().formats.pdf!)).toBe(true);
    await ensureFile(book('b'.repeat(64)), 'pdf');
    expect(downloads).toBe(1);
    expect((await cachedFiles()).find((f) => f.kind === 'pdf')!.sha256).toBe('b'.repeat(64));
  });

  it('a failed download records nothing and can be tried again', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 403 })) as typeof fetch;
    await expect(ensureFile(book('d'.repeat(64)), 'pdf')).rejects.toThrow('Download failed (403)');
    expect(await isCached('b1', 'pdf', { size: 13, sha256: 'd'.repeat(64) })).toBe(false);
  });
});
