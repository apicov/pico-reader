/**
 * The embedding model on the device (transformers.js in a Web Worker, embedWorker.ts): multilingual-e5-small,
 * the same quantized ONNX file the server uses (backend/app/embed.py), so a question embedded here matches the
 * passages embedded there. Loaded only when offline search is switched on; the files (~135 MB) are kept by the
 * browser.
 */
export const MODEL = 'Xenova/multilingual-e5-small';

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
let progressListener: ((f: number) => void) | undefined;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./embedWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: number; vectors?: Float32Array[]; message?: string; fraction?: number };
      if (m.type === 'progress') progressListener?.(m.fraction ?? 0);
      if (m.type === 'vectors' && m.id !== undefined) { waiting.get(m.id)?.resolve(m.vectors!); waiting.delete(m.id); }
      if (m.type === 'error' && m.id !== undefined) { waiting.get(m.id)?.reject(new Error(m.message)); waiting.delete(m.id); }
    };
  }
  return worker;
}

export function modelLoaded(): boolean {
  return ready !== null;
}

export function loadModel(onProgress?: (fraction: number) => void): Promise<void> {
  progressListener = onProgress;
  ready ??= new Promise<void>((resolve, reject) => {
    const w = getWorker();
    const listener = (e: MessageEvent) => {
      if (e.data.type === 'loaded') { w.removeEventListener('message', listener); resolve(); }
      if (e.data.type === 'error' && e.data.id === undefined) { w.removeEventListener('message', listener); reject(new Error(e.data.message)); }
    };
    w.addEventListener('message', listener);
    w.postMessage({ type: 'load', model: MODEL, wasmPaths: new URL('ort/', `${window.location.origin}/`).href });
  });
  ready.catch(() => { ready = null; });
  return ready;
}

/** L2-normalised vectors, mean-pooled like app/embed.py; kind "query" (questions) or "passage" (book text). */
export async function embedTexts(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  await loadModel(progressListener);
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'embed', id, texts, kind });
  });
}
