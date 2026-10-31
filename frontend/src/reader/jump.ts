import type { BookFormat } from '@/services/types';

/** A place to open the book at (a search result, a citation, a quote, a highlight made in another format) */
export interface Jump { format: BookFormat | null; location: string; progress: number }

/** The reader's address for a book, opening at a place when one is given (read back by `jumpFromParams`) */
export function readerPath(bookId: string, at?: { format?: string | null; location?: string; progress?: number }): string {
  const q = new URLSearchParams();
  if (at?.format) q.set('format', at.format);
  if (at?.location) q.set('location', at.location);
  if (at?.progress !== undefined) q.set('progress', String(at.progress));
  const query = q.toString(); // (not q.size: older WebViews lack it)
  return `/read/${encodeURIComponent(bookId)}${query ? `?${query}` : ''}`;
}

/** `?format=&location=&progress=` of the reader's address; null when it has none */
export function jumpFromParams(params: URLSearchParams): Jump | null {
  if (!params.get('format') && !params.get('location') && !params.get('progress')) return null;
  return { format: (params.get('format') || null) as BookFormat | null, location: params.get('location') ?? '',
    progress: Number(params.get('progress') ?? 0) };
}
