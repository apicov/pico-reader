import { ApiError } from '@/services/api';
import { cachedMyShelf, loadMyShelf, loadShelf, setOnMyShelf, setShelfStatus } from './shelf';

const net = vi.hoisted(() => ({ online: false, gone: new Set<string>(), calls: [] as string[],
  shelf: [] as object[], mine: [] as object[] }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? 'GET';
    if (method !== 'GET') {
      net.calls.push(`${method} ${path}`);
      const id = decodeURIComponent(path.split('/').pop()!);
      if (net.gone.has(id)) throw new ApiError(404, 'No such book');
      return null;
    }
    return path === '/api/shelf' ? net.shelf : net.mine;
  }),
}));

beforeEach(() => { localStorage.clear(); net.online = false; net.gone.clear(); net.calls.length = 0; net.shelf = []; net.mine = []; });

describe('shelf queue', () => {
  it('a change for a deleted book is dropped and the shelf still loads from the server', async () => {
    await setShelfStatus('gone-book', 'finished');
    await setShelfStatus('kept-book', 'reading');
    net.online = true;
    net.gone.add('gone-book');
    net.shelf = [{ book_id: 'kept-book', status: 'reading', progress: 0.2, last_read: null }];
    expect(await loadShelf()).toEqual(net.shelf);
    expect(net.calls).toEqual(['PUT /api/shelf/gone-book', 'PUT /api/shelf/kept-book']);
    net.calls.length = 0;
    await loadShelf();
    expect(net.calls).toEqual([]); // nothing left waiting
  });

  it('My shelf changes made offline are sent when back online, in order', async () => {
    await setOnMyShelf('b1', true);
    await setOnMyShelf('b2', true);
    await setOnMyShelf('b1', false);
    expect((await cachedMyShelf()).map((e) => e.book_id)).toEqual(['b2']);
    net.online = true;
    await loadMyShelf();
    expect(net.calls).toEqual(['DELETE /api/shelf/mine/b1', 'PUT /api/shelf/mine/b2']);
  });
});
