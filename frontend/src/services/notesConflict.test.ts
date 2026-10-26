import 'fake-indexeddb/auto';
import { ApiError } from '@/services/api';
import { changeNote, NoteConflict, type Note } from './notes';

const NOTE: Note = { id: 'note-1', title: 'Figuren', markdown: 'Neu aus vim', book_id: null, book_title: null, sources: [],
  project_id: null, project: null, created_at: '2026-10-25T10:00:00+00:00', updated_at: '2026-10-25T10:05:00+00:00' };
const calls = vi.hoisted(() => [] as { path: string; opts?: { method?: string; body?: Record<string, unknown> } }[]);
vi.mock('@/services/connectivity', () => ({ isOnline: () => true }));
vi.mock('@/services/api', async (original) => ({
  ...(await original<typeof import('@/services/api')>()),
  api: vi.fn(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    calls.push({ path, opts });
    if (opts?.method === 'PATCH' && opts.body?.updated_at_was && opts.body.updated_at_was !== NOTE.updated_at) {
      throw new ApiError(409, 'The note changed meanwhile');
    }
    return opts?.method === 'PATCH' ? { ...NOTE, ...opts.body } : NOTE;
  }),
}));

beforeEach(() => { calls.length = 0; });

describe('changing a note', () => {
  it('saved over a version changed elsewhere meanwhile: a conflict carrying that version', async () => {
    const e = await changeNote('note-1', { markdown: 'Meins' }, '2026-10-25T10:00:00+00:00').catch((x) => x);
    expect(e).toBeInstanceOf(NoteConflict);
    expect((e as NoteConflict).current.markdown).toBe('Neu aus vim');
  });

  it('on the current version, or without the check, it saves', async () => {
    expect((await changeNote('note-1', { markdown: 'Meins' }, NOTE.updated_at)).markdown).toBe('Meins');
    expect((await changeNote('note-1', { markdown: 'Trotzdem' })).markdown).toBe('Trotzdem');
    expect(calls.at(-1)?.opts?.body).toEqual({ markdown: 'Trotzdem' });
  });

  it('moves it to a project, or out of it', async () => {
    await changeNote('note-1', { project_id: 'proj-00000001' });
    await changeNote('note-1', { project_id: null });
    expect(calls.map((c) => c.opts?.body)).toEqual([{ project_id: 'proj-00000001' }, { project_id: null }]);
  });
});
