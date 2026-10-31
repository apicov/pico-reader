import type { BookFormat } from '@/services/types';

/** A place to open the book at (a search result, a citation, a quote, a highlight made in another format) */
export interface Jump { format: BookFormat | null; location: string; progress: number }

/** `?format=&location=&progress=` of the reader's address; null when it has none */
export function jumpFromParams(params: URLSearchParams): Jump | null {
  if (!params.get('format') && !params.get('location') && !params.get('progress')) return null;
  return { format: (params.get('format') || null) as BookFormat | null, location: params.get('location') ?? '',
    progress: Number(params.get('progress') ?? 0) };
}
