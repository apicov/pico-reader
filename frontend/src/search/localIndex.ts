/**
 * Searching downloaded books without a connection: each book's search file (written by the server's indexer)
 * holds its passages and their vectors; the question is embedded on the device (localModel.ts) and passages are
 * ranked like the server does: by meaning (cosine) and by words, fused with reciprocal ranks.
 */
import { gunzipSync } from 'fflate';
import { fileBlob } from '@/services/bookCache';
import type { Book } from '@/services/types';
import { float16ToFloat32 } from './float16';
import { embedTexts } from './localModel';


export interface LocalPassage {
  book_id: string;
  title: string;
  heading: string;
  format: string;
  location: string;
  progress: number;
  text: string;
  score: number;
}

interface BookIndex {
  book: Book;
  format: string;
  passages: { location: string; progress: number; heading: string; text: string }[];
  vectors: Float32Array; // passages × dims
  dims: number;
}

const loaded = new Map<string, BookIndex>(); // by book id + search sha
const CANDIDATES = 30;
const RRF_K = 60;

export async function loadBookIndex(book: Book): Promise<BookIndex> {
  const key = `${book.id}:${book.search?.sha256}`;
  const cached = loaded.get(key);
  if (cached) return cached;
  const raw = gunzipSync(new Uint8Array(await (await fileBlob(book.id, 'search')).arrayBuffer()));
  const data = JSON.parse(new TextDecoder().decode(raw)) as {
    dimensions: number; text_format: string; passages: BookIndex['passages']; vectors: string;
  };
  const bin = Uint8Array.from(atob(data.vectors), (c) => c.charCodeAt(0));
  const index = { book, format: data.text_format, passages: data.passages, vectors: float16ToFloat32(bin), dims: data.dimensions };
  loaded.set(key, index);
  return index;
}

const words = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}{3,}/gu) ?? [];

/** Best passages in the given (downloaded, indexed) books. */
export async function searchOffline(query: string, books: Book[], limit = 10): Promise<LocalPassage[]> {
  const indexes = await Promise.all(books.map(loadBookIndex));
  const [q] = await embedTexts([query], 'query');
  const all: { idx: BookIndex; i: number; cos: number; hits: number }[] = [];
  const terms = new Set(words(query));
  for (const idx of indexes) {
    for (let i = 0; i < idx.passages.length; i++) {
      let dot = 0;
      const off = i * idx.dims;
      for (let d = 0; d < idx.dims; d++) dot += q[d] * idx.vectors[off + d];
      const hits = terms.size ? words(idx.passages[i].text).filter((w) => terms.has(w)).length : 0;
      all.push({ idx, i, cos: dot, hits });
    }
  }
  const score = new Map<(typeof all)[number], number>();
  const byMeaning = [...all].sort((a, b) => b.cos - a.cos).slice(0, CANDIDATES);
  const byWords = all.filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, CANDIDATES);
  for (const ranking of [byMeaning, byWords]) {
    ranking.forEach((x, rank) => score.set(x, (score.get(x) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([x, s]) => {
    const p = x.idx.passages[x.i];
    return { book_id: x.idx.book.id, title: x.idx.book.title, heading: p.heading, format: x.idx.format,
      location: p.location, progress: p.progress, text: p.text, score: s };
  });
}

/** The vectors the server stored for a book, as arrays (for the in-browser indexing test). */
export async function serverVectors(book: Book): Promise<{ texts: string[]; vectors: Float32Array[] }> {
  const idx = await loadBookIndex(book);
  return {
    texts: idx.passages.map((p) => p.text),
    vectors: idx.passages.map((_, i) => idx.vectors.slice(i * idx.dims, (i + 1) * idx.dims)),
  };
}
