import 'fake-indexeddb/auto';
import { flushEvents, recordLookup, saveSession } from './events';

const net = vi.hoisted(() => ({ online: false, batches: [] as { sessions: { id: string }[]; lookups: unknown[] }[],
  during: null as null | (() => Promise<void>) }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (_path: string, opts: { body: { sessions: { id: string }[]; lookups: unknown[] } }) => {
    if (opts.body.sessions.length > 1000 || opts.body.lookups.length > 5000) throw new Error('422: batch too big');
    net.batches.push(opts.body);
    if (net.during) { const d = net.during; net.during = null; await d(); }
    return {};
  }),
}));

const session = (i: number, ended = '2026-10-25T10:01:00Z') => ({ id: `sess-${String(i).padStart(6, '0')}`, book_id: 'b1',
  format: 'epub', started_at: '2026-10-25T10:00:00Z', ended_at: ended, seconds: 60, progress_start: 0.1, progress_end: 0.11 });

beforeEach(() => { net.online = false; net.batches.length = 0; net.during = null; });

describe('sending reading events', () => {
  it('a long offline backlog goes in batches the server takes, and all of it arrives', async () => {
    for (let i = 0; i < 1001; i++) await saveSession(session(i)); // one over the server's limit per batch
    for (let i = 0; i < 30; i++) await recordLookup({ book_id: 'b1', language: 'de', word: `w${i}`, matched: '', dictionaries: [],
      found: true, location: '', context: '' });
    net.online = true;
    await flushEvents();
    expect(net.batches.every((b) => b.sessions.length <= 500)).toBe(true);
    expect(net.batches.flatMap((b) => b.sessions).length).toBe(1001);
    expect(net.batches.flatMap((b) => b.lookups).length).toBe(30);
    net.batches.length = 0;
    await flushEvents();
    expect(net.batches).toEqual([]); // all marked sent
  }, 30_000);

  it('a session that grows while being sent goes again with its new length', async () => {
    await saveSession(session(9000));
    net.online = true;
    net.during = () => saveSession(session(9000, '2026-10-25T10:05:00Z'));
    await flushEvents();
    await flushEvents();
    expect(net.batches.map((b) => b.sessions.map((s) => (s as { ended_at?: string }).ended_at))).toEqual([
      ['2026-10-25T10:01:00Z'], ['2026-10-25T10:05:00Z']]);
  });
});
