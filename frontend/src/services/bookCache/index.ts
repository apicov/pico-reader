/**
 * Books (and their covers) kept on the device for offline reading.
 *
 * One interface, two stores: on Android the files go to the app's data folder (downloaded natively, so a
 * 50 MB PDF never passes through the WebView as base64); on the web they are blobs in IndexedDB. A small
 * index (Preferences) records what is on the device and its sha256, so a book replaced on the server is
 * downloaded again.
 */
import { Capacitor } from '@capacitor/core';
import { api } from '@/services/api';
import { getPref, setPref } from '@/services/prefs';
import type { Book, FileRef } from '@/services/types';
import { nativeStore } from './native';
import { webStore } from './web';

export type FileKind = 'pdf' | 'epub' | 'reflow' | 'cover';

export interface CachedFile {
  bookId: string;
  kind: FileKind;
  sha256: string;
  size: number;
  savedAt: number;
}

export interface FileStore {
  /** Download `url` into the store; `onProgress` gets 0..1 */
  save(name: string, url: string, size: number, onProgress?: (fraction: number) => void): Promise<void>;
  /** A URL the WebView can load (object URL on the web, local file URL on Android) */
  url(name: string): Promise<string>;
  blob(name: string): Promise<Blob>;
  remove(name: string): Promise<void>;
}

const INDEX_KEY = 'book_cache_index';
/** Also used for dictionary images (res zips) */
export const store: FileStore = Capacitor.isNativePlatform() ? nativeStore : webStore;

let index: Record<string, CachedFile> | null = null;
const listeners = new Set<() => void>();

const fileName = (bookId: string, kind: FileKind) => `${bookId}/${kind}`;

async function loadIndex(): Promise<Record<string, CachedFile>> {
  if (!index) index = (await getPref<Record<string, CachedFile>>(INDEX_KEY)) ?? {};
  return index;
}

async function saveIndex(): Promise<void> {
  await setPref(INDEX_KEY, index);
  listeners.forEach((l) => l());
}

/** Re-render on cache changes (downloads, removals) */
export function subscribeCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function cachedFiles(): Promise<CachedFile[]> {
  return Object.values(await loadIndex());
}

/** Is this exact version of the file on the device? */
export async function isCached(bookId: string, kind: FileKind, file: FileRef): Promise<boolean> {
  return (await loadIndex())[fileName(bookId, kind)]?.sha256 === file.sha256;
}

/** Make sure the current version of a book's file is on the device. */
export async function ensureFile(book: Book, kind: Exclude<FileKind, 'cover'>,
                                 onProgress?: (fraction: number) => void): Promise<void> {
  const file = book.formats[kind];
  if (!file) throw new Error(`This book has no ${kind}`);
  if (await isCached(book.id, kind, file)) return;
  const link = await api<{ url: string }>(`/api/books/${encodeURIComponent(book.id)}/download?kind=${kind}`);
  await store.save(fileName(book.id, kind), link.url, file.size, onProgress);
  await record(book.id, kind, file);
}

/** Keep a book's cover for offline use (links come with the library). */
export async function ensureCover(book: Book): Promise<void> {
  if (!book.cover?.url || (await isCached(book.id, 'cover', book.cover))) return;
  await store.save(fileName(book.id, 'cover'), book.cover.url, book.cover.size);
  await record(book.id, 'cover', book.cover);
}

async function record(bookId: string, kind: FileKind, file: FileRef): Promise<void> {
  const idx = await loadIndex();
  idx[fileName(bookId, kind)] = { bookId, kind, sha256: file.sha256, size: file.size, savedAt: Date.now() };
  await saveIndex();
}

export async function fileUrl(bookId: string, kind: FileKind): Promise<string> {
  return store.url(fileName(bookId, kind));
}

export async function fileBlob(bookId: string, kind: FileKind): Promise<Blob> {
  return store.blob(fileName(bookId, kind));
}

/** Remove a book's files from the device (the cover stays: the library keeps showing it). */
export async function removeBook(bookId: string): Promise<void> {
  const idx = await loadIndex();
  for (const [name, f] of Object.entries(idx)) {
    if (f.bookId === bookId && f.kind !== 'cover') {
      await store.remove(name);
      delete idx[name];
    }
  }
  await saveIndex();
}
