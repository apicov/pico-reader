/** Sending a book's files: hashes, signed upload links from the server, PUTs straight to R2 with progress
 *  (XMLHttpRequest: fetch can't report upload progress), then commit. */
import { api } from '@/services/api';

export type Kind = 'pdf' | 'epub' | 'reflow' | 'cover';

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function put(url: string, blob: Blob, contentType: string, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed (network)'));
    xhr.send(blob);
  });
}

export async function uploadBook(meta: { id?: string; title: string; author: string; language: string },
                                 files: Partial<Record<Kind, { blob: Blob; type: string }>>,
                                 onProgress: (fraction: number) => void): Promise<string> {
  const entries = Object.entries(files) as [Kind, { blob: Blob; type: string }][];
  const info = Object.fromEntries(await Promise.all(entries.map(async ([kind, f]) =>
    [kind, { size: f.blob.size, sha256: await sha256(f.blob), content_type: f.type }] as const)));
  const res = await api<{ id: string; uploads: Record<string, string> }>('/api/books', {
    method: 'POST', body: { ...meta, files: info } });
  const total = entries.reduce((n, [, f]) => n + f.blob.size, 0);
  const sent: Record<string, number> = {};
  for (const [kind, f] of entries) {
    await put(res.uploads[kind], f.blob, f.type, (n) => {
      sent[kind] = n;
      onProgress(Object.values(sent).reduce((a, b) => a + b, 0) / total);
    });
  }
  await api(`/api/books/${encodeURIComponent(res.id)}/commit`, { method: 'POST' });
  return res.id;
}
