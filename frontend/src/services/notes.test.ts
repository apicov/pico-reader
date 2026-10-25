import 'fake-indexeddb/auto';
import { cachedNotes, changeNote, deleteNote, getNote, loadNotes } from './notes';

const net = vi.hoisted(() => ({ online: true, notes: [] as Record<string, unknown>[] }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (!net.online) throw new Error('offline');
    const id = decodeURIComponent(path.split('/').pop()!);
    if (opts?.method === 'PATCH') return { ...net.notes.find((n) => n.id === id), ...opts.body, updated_at: '2026-10-26T00:00:00Z' };
    if (opts?.method === 'DELETE') return null;
    return path === '/api/notes' ? net.notes : net.notes.find((n) => n.id === id);
  }),
}));

const note = (id: string, book: string | null, updated: string) => ({ id, title: id, markdown: `# ${id}`, book_id: book,
  book_title: book && 'Die Wolke', sources: [], created_at: updated, updated_at: updated });

describe('notes', () => {
  it('keeps the notes on the device and reads them offline, newest first, per book', async () => {
    net.notes = [note('n2', 'b1', '2026-10-25T10:00:00Z'), note('n1', null, '2026-10-24T10:00:00Z')];
    await loadNotes();
    net.online = false;
    expect((await loadNotes()).map((n) => n.id)).toEqual(['n2', 'n1']);
    expect((await cachedNotes('b1')).map((n) => n.id)).toEqual(['n2']);
    expect((await getNote('n1'))?.markdown).toBe('# n1');
  });

  it('a change and a delete update the copy on the device', async () => {
    net.online = true;
    await changeNote('n1', { title: 'Renamed' });
    expect((await cachedNotes()).map((n) => [n.id, n.title])).toEqual([['n1', 'Renamed'], ['n2', 'n2']]);
    await deleteNote('n2');
    expect((await cachedNotes()).map((n) => n.id)).toEqual(['n1']);
  });

  it('a note deleted on another device leaves this one at the next load', async () => {
    net.notes = [];
    expect(await loadNotes()).toEqual([]);
    expect(await cachedNotes()).toEqual([]);
  });
});
