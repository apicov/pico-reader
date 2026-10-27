import { ApiError } from '@/services/api';
import { cachedCollections, cachedMyShelf, createCollection, deleteCollection, loadCollections, loadMyShelf, loadShelf,
  moveCollection, renameCollection, setInCollection, setOnMyShelf, setShelfStatus, shelfFolders } from './shelf';

const net = vi.hoisted(() => ({ online: false, gone: new Set<string>(), calls: [] as string[],
  shelf: [] as object[], mine: [] as object[], collections: [] as object[] }));
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
    return path === '/api/shelf' ? net.shelf : path === '/api/shelf/collections' ? net.collections : net.mine;
  }),
}));

beforeEach(() => { localStorage.clear(); net.online = false; net.gone.clear(); net.calls.length = 0; net.shelf = []; net.mine = []; net.collections = []; });

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

describe('collections', () => {
  const short = (calls: string[]) => calls.map((c) => c.replace(/col-[0-9a-f-]+/g, 'COL'));

  it('made offline: shown at once, sent in order when back online', async () => {
    const uni = await createCollection('Uni ');
    await setInCollection(uni, 'b1', true);
    expect((await cachedCollections()).map((c) => [c.name, c.book_ids])).toEqual([['Uni', ['b1']]]);
    expect((await cachedMyShelf()).map((e) => e.book_id)).toEqual(['b1']); // in a collection = on My shelf
    await renameCollection(uni, 'Studium');
    net.online = true;
    await loadCollections();
    expect(short(net.calls)).toEqual(['PUT /api/shelf/collections/COL', 'PUT /api/shelf/collections/COL/books/b1',
      'PUT /api/shelf/collections/COL']);
  });

  it('taking a book off My shelf offline cancels its queued collection adds', async () => {
    const id = await createCollection('Krimis');
    await setInCollection(id, 'b2', true);
    await setOnMyShelf('b2', false);
    expect((await cachedCollections()).find((c) => c.id === id)!.book_ids).toEqual([]);
    net.online = true;
    await loadMyShelf();
    expect(short(net.calls)).toEqual(['DELETE /api/shelf/mine/b2', 'PUT /api/shelf/collections/COL']);
  });

  it('a change the server refuses is dropped; moving and deleting work', async () => {
    const a = await createCollection('A');
    const b = await createCollection('B');
    await moveCollection(b, -1);
    expect((await cachedCollections()).map((c) => c.name)).toEqual(['B', 'A']);
    await deleteCollection(a);
    net.gone.add(a); // e.g. deleted on another device meanwhile
    net.online = true;
    await loadCollections();
    net.calls.length = 0;
    await loadCollections();
    expect(net.calls).toEqual([]);
  });
});

describe('shelfFolders', () => {
  it('puts each collection\'s books in shelf order and leaves the rest loose', () => {
    const col = (id: string, book_ids: string[]) => ({ id, name: id, position: 0, book_ids });
    const { folders, loose } = shelfFolders([col('A', ['b3', 'b1', 'gone']), col('B', ['b1']), col('C', [])], ['b1', 'b2', 'b3', 'b4']);
    expect(folders.map((f) => [f.collection.id, f.books])).toEqual([['A', ['b1', 'b3']], ['B', ['b1']], ['C', []]]);
    expect(loose).toEqual(['b2', 'b4']);
  });
});
