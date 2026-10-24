/** Browser store: blobs in IndexedDB (Dexie). navigator.storage.persist() (main.tsx) keeps the browser from evicting them. */
import Dexie, { type EntityTable } from 'dexie';
import type { FileStore } from './index';

interface StoredFile {
  name: string;
  blob: Blob;
}

const db = new Dexie('pico-reader-books') as Dexie & { files: EntityTable<StoredFile, 'name'> };
db.version(1).stores({ files: 'name' });

const objectUrls = new Map<string, string>();

async function download(url: string, size: number, onProgress?: (fraction: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(1, received / size));
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get('Content-Type') ?? '' });
}

export const webStore: FileStore = {
  async save(name, url, size, onProgress) {
    const blob = await download(url, size, onProgress);
    await db.files.put({ name, blob });
    const old = objectUrls.get(name);
    if (old) URL.revokeObjectURL(old);
    objectUrls.delete(name);
  },
  async blob(name) {
    const row = await db.files.get(name);
    if (!row) throw new Error('Not on this device');
    return row.blob;
  },
  async url(name) {
    let url = objectUrls.get(name);
    if (!url) {
      url = URL.createObjectURL(await this.blob(name));
      objectUrls.set(name, url);
    }
    return url;
  },
  async remove(name) {
    await db.files.delete(name);
    const old = objectUrls.get(name);
    if (old) URL.revokeObjectURL(old);
    objectUrls.delete(name);
  },
};
