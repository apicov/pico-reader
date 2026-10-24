import 'fake-indexeddb/auto';
import { webStore } from './web';

function mockFetch(body: string) {
  globalThis.fetch = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/pdf' } })) as typeof fetch;
}

describe('webStore', () => {
  it('stores a download and reports progress up to 1', async () => {
    mockFetch('%PDF-1.4 book');
    const progress: number[] = [];
    await webStore.save('b1/pdf', 'https://r2/x', 13, (f) => progress.push(f));
    expect(progress[progress.length - 1]).toBe(1);
    expect(await (await webStore.blob('b1/pdf')).text()).toBe('%PDF-1.4 book');
  });

  it('removes a file', async () => {
    mockFetch('x');
    await webStore.save('b2/pdf', 'https://r2/y', 1);
    await webStore.remove('b2/pdf');
    await expect(webStore.blob('b2/pdf')).rejects.toThrow('Not on this device');
  });
});
