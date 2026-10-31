import { ApiError, authFetch, errorFrom, setUnauthorizedHandler } from './api';

afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(() => {}); });

describe('authFetch', () => {
  it('signs the reader out on a 401, as api() does', async () => {
    const signedOut = vi.fn();
    setUnauthorizedHandler(signedOut);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Token expired"}', { status: 401 })));
    const res = await authFetch('/api/export');
    expect(signedOut).toHaveBeenCalledOnce();
    expect((await errorFrom(res, 'Download failed')).message).toBe('Token expired');
  });

  it('a failure to connect is an ApiError(0); a stopped request stays an AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(authFetch('/x')).rejects.toEqual(new ApiError(0, 'Cannot reach the server'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('stopped', 'AbortError'); }));
    await expect(authFetch('/x')).rejects.toHaveProperty('name', 'AbortError');
  });

  it("errorFrom falls back to a message with the status when the server didn't say", async () => {
    expect((await errorFrom(new Response('oops', { status: 502 }), 'Download failed')).message).toBe('Download failed (502)');
  });
});
