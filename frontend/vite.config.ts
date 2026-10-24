import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
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
