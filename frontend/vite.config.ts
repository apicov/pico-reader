import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

/** The ONNX runtime's WebAssembly for transformers.js (offline search), served by the app itself instead of a
 *  CDN, so it works offline (bundled in the Android app, cached by the service worker on the web). */
function copyOnnxRuntime(): Plugin {
  return {
    name: 'copy-onnx-runtime',
    buildStart() {
      const from = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist')
      const to = path.resolve(__dirname, 'public/ort')
      fs.mkdirSync(to, { recursive: true })
      for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) fs.copyFileSync(path.join(from, f), path.join(to, f))
    },
    // transformers.js references its own (WebGPU) build of the runtime, 21 MB that is never fetched here
    // (wasmPaths points at /ort/): keep it out of the build and the Android app
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name]
    },
  }
}

/** The diagram library (mermaid, ~3 MB in some 60 chunks) only loads when a text has a diagram, so the service
 *  worker shouldn't fetch it on install. This finds the chunks reachable only through `import('mermaid')`
 *  (anything the rest of the app also uses, like katex, stays precached); they're cached when first used. */
const diagramOnly = new Set<string>()

function findDiagramChunks(): Plugin {
  return {
    name: 'find-diagram-chunks',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
      const byName = new Map(chunks.map((c) => [c.fileName, c]))
      // the chunk holding mermaid itself (it has no facade module: its diagram chunks import from it)
      const isMermaid = (name: string) => !!byName.get(name)?.moduleIds.some((id) => id.includes('/node_modules/mermaid/'))
      const reached = new Set<string>()
      const visit = (name: string) => {
        const c = byName.get(name)
        if (!c || reached.has(name)) return
        reached.add(name)
        for (const i of c.imports) visit(i)
        for (const i of c.dynamicImports) if (!isMermaid(i)) visit(i)
      }
      for (const c of chunks) if (c.isEntry) visit(c.fileName)
      diagramOnly.clear()
      for (const c of chunks) if (!reached.has(c.fileName)) diagramOnly.add(c.fileName)
    },
  }
}

export default defineConfig({
  plugins: [
    copyOnnxRuntime(),
    findDiagramChunks(),
    react(),
    // Web-app install + offline shell. The service worker is registered in main.tsx and only on the
    // web: the same dist/ is synced into the Android app, where a SW would pin stale builds.
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      manifest: {
        name: 'Pico Reader',
        short_name: 'Reader',
        description: 'My library, offline, with dictionaries and translation.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf8f3',
        theme_color: '#faf8f3',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/health/],
        cleanupOutdatedCaches: true,
        // control the page from the first visit, so what loads later (diagrams) is kept for offline use already
        clientsClaim: true,
        manifestTransforms: [async (entries) => ({ manifest: entries.filter((e) => !diagramOnly.has(e.url)), warnings: [] })],
        runtimeCaching: [
          // the ONNX runtime (11 MB, too big to precache): kept once fetched, for offline search
          { urlPattern: /\/ort\/.*/, handler: 'CacheFirst', options: { cacheName: 'onnx-runtime' } },
          // the diagram chunks left out of the precache: kept once fetched (hashed names never change)
          { urlPattern: /\/assets\/.*\.js$/, handler: 'CacheFirst',
            options: { cacheName: 'diagrams', expiration: { maxEntries: 150 } } },
          // the user manual's pictures: not precached (most never get looked at), kept once seen; the same name is
          // retaken after a change, so a newer one replaces it on the next visit
          { urlPattern: /\/manual\/.*\.webp$/, handler: 'StaleWhileRevalidate', options: { cacheName: 'manual' } },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:8030' },
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' },
      // transformers.js: the plain WebAssembly runtime (11 MB, served from /ort/), not the WebGPU one (21 MB)
      { find: /^onnxruntime-web$/, replacement: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs') },
    ],
  },
  // the embedding worker imports transformers.js (offline search): module workers, alias applied as in the app
  worker: { format: 'es', plugins: () => [] },
  // Syntax down-levelled for older Android WebViews; runtime methods come from core-js (polyfills.ts)
  build: { target: 'es2017' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
})
