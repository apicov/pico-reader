import { flushPositions, savePosition } from './position';

const net = vi.hoisted(() => ({ sent: [] as { book_id: string; location: string }[], hold: null as Promise<void> | null }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => true }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (_path: string, opts: { body: { book_id: string; location: string } }) => {
    if (net.hold) await net.hold;
    net.sent.push(opts.body);
    return null;
  }),
}));

beforeEach(() => { localStorage.clear(); net.sent.length = 0; net.hold = null; });

describe('positions', () => {
  it('a place saved while the last one is being sent is sent too', async () => {
    await savePosition({ book_id: 'b', format: 'epub', location: 'one', progress: 0.1 });
    let release = () => {};
    net.hold = new Promise((r) => { release = r; });
    const flushing = flushPositions();
    await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 10)); // the first is on its way
    await savePosition({ book_id: 'b', format: 'epub', location: 'two', progress: 0.2 });
    net.hold = null;
    release();
    await flushing;
    await flushPositions();
    expect(net.sent.map((p) => p.location).at(-1)).toBe('two');
  });
});
