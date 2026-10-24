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

export default defineConfig({
  plugins: [
    copyOnnxRuntime(),
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
        // the ONNX runtime (11 MB, too big to precache): kept once fetched, for offline search
        runtimeCaching: [{ urlPattern: /\/ort\/.*/, handler: 'CacheFirst', options: { cacheName: 'onnx-runtime' } }],
      },
    }),
  ],
  server: {
    proxy: { '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:8030' },
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' }],
  },
  // Syntax down-levelled for older Android WebViews; runtime methods come from core-js (polyfills.ts)
  build: { target: 'es2017' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
})
