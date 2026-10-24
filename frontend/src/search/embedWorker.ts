/// <reference lib="webworker" />
/** The embedding model in a Web Worker, so embedding many passages doesn't freeze the page (localModel.ts). */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

type Request =
  | { type: 'load'; model: string; wasmPaths: string }
  | { type: 'embed'; id: number; texts: string[]; kind: 'query' | 'passage' };

let pipe: Promise<FeatureExtractionPipeline> | null = null;

async function load(model: string, wasmPaths: string): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = wasmPaths;
    onnx.wasm.numThreads = 1; // threads need cross-origin isolation, which the app doesn't have
  }
  const loaded: Record<string, number> = {};
  const total: Record<string, number> = {};
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  // pipeline()'s overloads are too complex for TypeScript: a narrower signature for this one use
  const make = pipeline as unknown as (task: string, model: string, options: object) => Promise<FeatureExtractionPipeline>;
  return make('feature-extraction', model, {
    dtype: 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file && p.total) {
        loaded[p.file] = p.loaded ?? 0;
        total[p.file] = p.total;
        self.postMessage({ type: 'progress', fraction: sum(loaded) / Math.max(1, sum(total)) });
      }
    },
  });
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      pipe ??= load(msg.model, msg.wasmPaths);
      await pipe;
      self.postMessage({ type: 'loaded' });
      return;
    }
    const extractor = await pipe!;
    const vectors: Float32Array[] = [];
    for (let i = 0; i < msg.texts.length; i += 8) {
      const res = await extractor(msg.texts.slice(i, i + 8).map((t) => `${msg.kind}: ${t}`), { pooling: 'mean', normalize: true });
      const dims = res.dims[res.dims.length - 1];
      const data = res.data as Float32Array;
      for (let j = 0; j < data.length / dims; j++) vectors.push(data.slice(j * dims, (j + 1) * dims));
    }
    self.postMessage({ type: 'vectors', id: msg.id, vectors });
  } catch (err) {
    if (msg.type === 'load') pipe = null;
    self.postMessage({ type: 'error', id: msg.type === 'embed' ? msg.id : undefined, message: (err as Error).message });
  }
};
