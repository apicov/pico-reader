/**
 * The embedding model on the device (transformers.js): multilingual-e5-small, the same quantized ONNX file
 * the server uses (backend/app/embed.py), so a question embedded here matches the passages embedded there.
 * Loaded only when offline search is switched on; the model files (~135 MB) are kept by the browser.
 */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

export const MODEL = 'Xenova/multilingual-e5-small';
let pipe: Promise<FeatureExtractionPipeline> | null = null;

export function modelLoaded(): boolean {
  return pipe !== null;
}

export async function loadModel(onProgress?: (fraction: number) => void): Promise<void> {
  pipe ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
    if (onnx.wasm) {
      onnx.wasm.wasmPaths = new URL('ort/', `${window.location.origin}/`).href;
      onnx.wasm.numThreads = 1; // threads need cross-origin isolation, which the app doesn't have
    }
    const loaded: Record<string, number> = {};
    const total: Record<string, number> = {};
    // pipeline()'s overloads are too complex for TypeScript: a narrower signature for this one use
    const make = pipeline as unknown as (task: string, model: string, options: object) => Promise<FeatureExtractionPipeline>;
    return (await make('feature-extraction', MODEL, {
      dtype: 'q8',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          loaded[p.file] = p.loaded ?? 0;
          total[p.file] = p.total;
          const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
          onProgress?.(sum(loaded) / Math.max(1, sum(total)));
        }
      },
    })) as FeatureExtractionPipeline;
  })();
  pipe.catch(() => { pipe = null; });
  await pipe;
}

/** L2-normalised vectors, mean-pooled like app/embed.py; kind "query" (questions) or "passage" (book text). */
export async function embedTexts(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  if (!pipe) await loadModel();
  const extractor = await pipe!;
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 8) {
    const res = await extractor(texts.slice(i, i + 8).map((t) => `${kind}: ${t}`), { pooling: 'mean', normalize: true });
    const dims = res.dims[res.dims.length - 1];
    const data = res.data as Float32Array;
    for (let j = 0; j < data.length / dims; j++) out.push(data.slice(j * dims, (j + 1) * dims));
  }
  return out;
}
