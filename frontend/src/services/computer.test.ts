import { ApiError } from '@/services/api';
import { flushComputer, sendToComputer } from './computer';

const net = vi.hoisted(() => ({ online: false, posted: [] as { id: string; body: string }[], reject: '' }));
vi.mock('@/services/connectivity', () => ({ isOnline: () => net.online }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (_path: string, opts: { body: { id: string; body: string } }) => {
    if (!net.online) throw new ApiError(0, 'offline');
    if (opts.body.body === net.reject) throw new ApiError(422, 'too many waiting');
    net.posted.push(opts.body);
    return { id: opts.body.id };
  }),
}));

beforeEach(() => { localStorage.clear(); net.online = false; net.posted.length = 0; net.reject = ''; });

describe('send to computer', () => {
  it('offline: queued, then sent in order when back online', async () => {
    expect(await sendToComputer({ kind: 'highlight', body: 'eins' })).toBe('queued');
    expect(await sendToComputer({ kind: 'snippet', language: 'python', body: 'print(2)' })).toBe('queued');
    net.online = true;
    await flushComputer();
    expect(net.posted.map((d) => d.body)).toEqual(['eins', 'print(2)']);
    expect(new Set(net.posted.map((d) => d.id)).size).toBe(2); // each has its own id: a resend is harmless
    expect(await sendToComputer({ kind: 'text', body: 'drei' })).toBe('sent');
  });

  it('an item the server refuses is dropped and the rest goes on', async () => {
    await sendToComputer({ kind: 'text', body: 'bad' });
    await sendToComputer({ kind: 'text', body: 'good' });
    net.online = true;
    net.reject = 'bad';
    await flushComputer();
    expect(net.posted.map((d) => d.body)).toEqual(['good']);
  });

  it('keeps a very long text within what the server takes', async () => {
    net.online = true;
    await sendToComputer({ kind: 'note', body: 'x'.repeat(250_000) });
    expect(net.posted[0].body.length).toBe(200_000);
  });
});
