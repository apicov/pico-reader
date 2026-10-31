/**
 * Backend client, from tsp-publisher (same split as the tracker's services/api/index.ts httpFetch):
 * CapacitorHttp on native, where WebView CORS rules don't apply; fetch on the web.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** A backend URL for things the browser loads itself (images) */
export const apiUrl = (path: string) => API_URL + path;
const TOKEN_KEY = 'reader_token';
const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let cachedToken: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cachedToken === undefined) cachedToken = (await Preferences.get({ key: TOKEN_KEY })).value;
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
  else await Preferences.remove({ key: TOKEN_KEY });
}

/** Called when the backend says the token is no longer good (expired, reader removed). */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Sent as If-None-Match; a 304 then resolves to NOT_MODIFIED */
  etag?: string;
  /** Receives the reply's ETag header */
  onEtag?: (etag: string) => void;
}

export const NOT_MODIFIED = Symbol('not modified');

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, etag, onEtag } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  const token = auth ? await getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = API_URL + path;

  let status: number;
  let data: unknown;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({ method, url, headers, data: body, connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS })
      .catch(() => { throw new ApiError(0, 'Cannot reach the server'); });
    status = res.status;
    data = typeof res.data === 'string' && res.data ? safeJson(res.data) : res.data;
    const tag = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'etag')?.[1];
    if (tag) onEtag?.(tag);
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      status = res.status;
      const tag = res.headers.get('ETag');
      if (tag) onEtag?.(tag);
      const text = await res.text();
      data = text ? safeJson(text) : null;
    } catch (e) {
      throw new ApiError(0, (e as Error).name === 'AbortError' ? 'The server took too long to answer' : 'Cannot reach the server');
    } finally {
      clearTimeout(timer);
    }
  }

  if (status === 304) return NOT_MODIFIED as T;
  if (status === 401 && auth) onUnauthorized();
  if (status < 200 || status >= 300) throw errorWithDetail(status, data, `Request failed (${status})`);
  return data as T;
}

/** fetch with the reader's token, for what `api` can't do (a streamed answer, a file): a 401 signs the reader
 *  out as in `api`, and a failure to connect is an ApiError(0). The caller checks `res.ok` (see `errorFrom`). */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(API_URL + path, { ...init, headers }).catch((e: Error) => {
    throw e.name === 'AbortError' ? e : new ApiError(0, 'Cannot reach the server');
  });
  if (res.status === 401) onUnauthorized();
  return res;
}

/** The ApiError for a failed `authFetch` reply, with the server's message when it gave one */
export async function errorFrom(res: Response, fallback: string): Promise<ApiError> {
  return errorWithDetail(res.status, await res.json().catch(() => null), `${fallback} (${res.status})`);
}

function errorWithDetail(status: number, data: unknown, fallback: string): ApiError {
  const detail = (data as { detail?: unknown } | null)?.detail;
  return new ApiError(status, typeof detail === 'string' ? detail : fallback);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
