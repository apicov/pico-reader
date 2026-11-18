import { getPref } from '@/services/prefs';
import { closeTab, createWorkspace, currentWorkspace, deleteWorkspace, frontBook, MAX_BOOKS, merge, openInWorkspace,
  renameWorkspace, switchWorkspace, syncWorkspaces, workspaces, type Workspace } from './workspaces';

const net = vi.hoisted(() => ({ online: false, calls: [] as { path: string; body: Record<string, unknown> }[],
  remote: [] as object[], hold: null as Promise<void> | null }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (opts?.method === 'PUT') {
      net.calls.push({ path, body: opts.body! });
      if (net.hold) await net.hold;
      return { ...opts.body, id: decodeURIComponent(path.split('/').pop()!), updated_at: '2026-11-18T10:00:00+00:00' };
    }
    return net.remote;
  }),
}));

beforeEach(() => { localStorage.clear(); net.online = false; net.calls.length = 0; net.remote = []; net.hold = null; });

const ws = (id: string, at: string, extra: Partial<Workspace> = {}): Workspace =>
  ({ id, name: id, book_ids: [], position: 0, updated_at: at, ...extra });

describe('merge', () => {
  it('takes the newer of each, keeps unsent new ones, drops ones deleted elsewhere', () => {
    const local = [ws('a', '2026-01-02T00:00:00Z', { name: 'mine' }), ws('b', '2026-01-01T00:00:00Z'),
      ws('gone', '2026-01-01T00:00:00Z'), ws('new', '')];
    const remote = [ws('a', '2026-01-01T00:00:00+00:00'), ws('b', '2026-01-03T00:00:00+00:00', { name: 'theirs' })];
    const { list, resend } = merge(local, remote, ['new']);
    expect(list.map((w) => [w.id, w.name])).toEqual([['a', 'mine'], ['b', 'theirs'], ['new', 'new']]);
    expect(resend).toEqual(['a']); // newer here but not queued: sent again
  });
});

describe('tabs', () => {
  it('opening books adds tabs to a first "Reading" workspace; opening one again only brings it to the front', async () => {
    await openInWorkspace('b1');
    await openInWorkspace('b2');
    await openInWorkspace('b1');
    const w = await currentWorkspace();
    expect(w.name).toBe('Reading');
    expect(w.book_ids).toEqual(['b1', 'b2']);
    expect(await frontBook(w)).toBe('b1');
  });

  it('a full workspace gives up its leftmost tab other than the one in front', async () => {
    for (let i = 1; i <= MAX_BOOKS; i++) await openInWorkspace(`b${i}`);
    await openInWorkspace('b1'); // in front
    await openInWorkspace('new');
    const w = await currentWorkspace();
    expect(w.book_ids).toHaveLength(MAX_BOOKS);
    expect(w.book_ids).toContain('b1');
    expect(w.book_ids).not.toContain('b2');
    expect(w.book_ids.at(-1)).toBe('new');
  });

  it('closing the tab in front brings its neighbour; closing the last leaves none', async () => {
    await openInWorkspace('b1');
    await openInWorkspace('b2');
    await openInWorkspace('b3');
    await openInWorkspace('b2');
    expect(await closeTab('b2')).toBe('b3');
    expect(await closeTab('b1')).toBe('b3'); // not the one in front: it stays in front
    expect(await closeTab('b3')).toBeNull();
  });

  it('workspaces: new (with the book being read), rename, switch, delete', async () => {
    await openInWorkspace('b1');
    await openInWorkspace('b2');
    const reading = (await currentWorkspace()).id;
    const thesis = await createWorkspace(' Thesis ', 'b2');
    expect((await currentWorkspace()).book_ids).toEqual(['b2']);
    await renameWorkspace(thesis, 'Thesis 2');
    expect((await workspaces()).map((w) => w.name)).toEqual(['Reading', 'Thesis 2']);
    expect(await switchWorkspace(reading)).toBe('b2'); // its tab in front on this device
    await deleteWorkspace(reading);
    expect((await currentWorkspace()).id).toBe(thesis);
  });
});

describe('sync', () => {
  it('changes made offline go once each, with their latest state; the server\'s time is taken', async () => {
    await openInWorkspace('b1');
    await openInWorkspace('b2');
    net.online = true;
    await syncWorkspaces();
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].body.book_ids).toEqual(['b1', 'b2']);
    net.remote = net.calls.map((c) => ({ ...c.body, id: decodeURIComponent(c.path.split('/').pop()!),
      updated_at: '2026-11-18T10:00:00+00:00' }));
    net.calls.length = 0;
    await syncWorkspaces();
    expect(net.calls).toEqual([]); // nothing left to send, and not sent again
    expect((await currentWorkspace()).updated_at).toBe('2026-11-18T10:00:00+00:00');
  });

  it('a workspace from another device arrives; one deleted elsewhere goes', async () => {
    await openInWorkspace('b1');
    net.online = true;
    await syncWorkspaces();
    net.remote = [ws('ws-other', '2026-11-18T09:00:00+00:00', { name: 'From the tablet', book_ids: ['b9'] })];
    await syncWorkspaces();
    expect((await workspaces()).map((w) => w.name)).toEqual(['From the tablet']);
  });

  it('a deleted workspace is sent as deleted, then forgotten here', async () => {
    await openInWorkspace('b1');
    const id = (await currentWorkspace()).id;
    await deleteWorkspace(id);
    net.online = true;
    await syncWorkspaces();
    expect(net.calls.at(-1)?.body.deleted).toBe(true);
    expect(await getPref('workspaces')).toEqual([]); // the tombstone too, once the server has it
  });
});
