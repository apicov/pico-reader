import 'fake-indexeddb/auto';
import { ApiError } from '@/services/api';
import { addCard, allCards, syncReview } from './review';

const net = vi.hoisted(() => ({ online: false, reject: new Set<string>(), down: false, puts: [] as { term: string }[] }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (net.down) throw new ApiError(0, 'Cannot reach the server');
    if (opts?.method === 'PUT') {
      const body = opts.body as { term: string };
      net.puts.push(body);
      if (net.reject.has(body.term)) throw new ApiError(422, 'example: at most 2000 characters');
      return { ...opts.body, id: decodeURIComponent(path.split('/').pop()!), updated_at: new Date().toISOString() };
    }
    return { cards: [], cursor: null };
  }),
}));

const card = (term: string, example = '') => ({ language: 'de', term, meaning: 'm', example, source: 'translation' as const, book_id: null });

beforeEach(() => { net.online = false; net.reject.clear(); net.down = false; net.puts.length = 0; });

describe('review card sync', () => {
  it('a card the server rejects does not block the ones after it', async () => {
    await addCard(card('eins'));
    await addCard(card('zwei'));
    await addCard(card('drei'));
    net.online = true;
    net.reject.add('zwei');
    await syncReview();
    expect(net.puts.map((c) => c.term).sort()).toEqual(['drei', 'eins', 'zwei']);
    net.puts.length = 0;
    await syncReview();
    expect(net.puts).toEqual([]);
    expect((await allCards()).map((c) => c.term)).toContain('zwei');
  });

  it('keeps a long example (a whole translated passage) within what the server takes', async () => {
    await addCard({ ...card('lang', 'x'.repeat(5000)), meaning: 'y'.repeat(3000) });
    const c = (await allCards()).find((x) => x.term === 'lang')!;
    expect([c.example.length, c.meaning.length]).toEqual([2000, 2000]);
  });

  it('a network failure keeps cards for the next sync', async () => {
    await addCard(card('vier'));
    net.online = true;
    net.down = true;
    await expect(syncReview()).rejects.toThrow();
    net.down = false;
    await syncReview();
    expect(net.puts.map((c) => c.term)).toContain('vier');
  });
});
