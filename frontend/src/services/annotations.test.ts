import 'fake-indexeddb/auto';
import { ApiError } from '@/services/api';
import { annotationsFor, saveAnnotation, syncAnnotations, updateAnnotation } from './annotations';

const net = vi.hoisted(() => ({ online: false, reject: new Set<string>(), down: false, puts: [] as string[],
  remote: [] as object[] }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (net.down) throw new ApiError(0, 'Cannot reach the server');
    if (opts?.method === 'PUT') {
      const id = decodeURIComponent(path.split('/').pop()!);
      net.puts.push(id);
      if (net.reject.has(id)) throw new ApiError(422, 'text: at most 5000 characters');
      return { ...opts.body, id, updated_at: new Date().toISOString() };
    }
    return { annotations: net.remote, cursor: net.remote.length ? '2026-10-25T00:00:00Z' : null };
  }),
}));

const hl = (id: string, text = 'Sie hatten Mühe') => ({ id, book_id: 'b1', kind: 'highlight' as const, format: 'epub',
  location: `cfi-${id}`, progress: 0.1, text });

beforeEach(() => { net.online = false; net.reject.clear(); net.down = false; net.puts.length = 0; net.remote = []; });

describe('annotation sync', () => {
  it('a highlight the server rejects does not block the ones after it', async () => {
    await saveAnnotation(hl('aaaaaaaa-1'));
    await saveAnnotation(hl('aaaaaaaa-2'));
    await saveAnnotation(hl('aaaaaaaa-3'));
    net.online = true;
    net.reject.add('aaaaaaaa-2');
    await syncAnnotations();
    expect(net.puts).toEqual(['aaaaaaaa-1', 'aaaaaaaa-2', 'aaaaaaaa-3']);
    // the rejected one isn't sent again and again; it stays on this device
    net.puts.length = 0;
    await syncAnnotations();
    expect(net.puts).toEqual([]);
    expect((await annotationsFor('b1')).map((a) => a.id)).toContain('aaaaaaaa-2');
  });

  it('a network failure keeps changes for the next sync', async () => {
    await saveAnnotation(hl('bbbbbbbb-1'));
    net.online = true;
    net.down = true;
    await expect(syncAnnotations()).rejects.toThrow();
    net.down = false;
    await syncAnnotations();
    expect(net.puts).toContain('bbbbbbbb-1');
  });

  it('keeps highlight text and notes within what the server takes', async () => {
    const a = await saveAnnotation(hl('cccccccc-1', 'x'.repeat(9000)));
    expect(a.text.length).toBe(5000);
    await updateAnnotation(a.id, { note: 'n'.repeat(7000) });
    expect((await annotationsFor('b1')).find((x) => x.id === a.id)!.note.length).toBe(5000);
  });

  it('pulls other devices\' changes; a newer local edit wins over an older remote one', async () => {
    await saveAnnotation(hl('dddddddd-1'));
    const mine = (await annotationsFor('b1')).find((a) => a.id === 'dddddddd-1')!;
    net.remote = [{ ...mine, note: 'older remote', client_updated_at: '2020-01-01T00:00:00Z', dirty: undefined },
      { ...hl('eeeeeeee-1'), note: '', color: 'yellow', deleted: false, client_updated_at: '2026-10-25T00:00:00Z' }];
    net.online = true;
    await syncAnnotations();
    const all = await annotationsFor('b1');
    expect(all.find((a) => a.id === 'dddddddd-1')!.note).toBe('');
    expect(all.map((a) => a.id)).toContain('eeeeeeee-1');
  });
});
