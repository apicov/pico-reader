import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import './theme/fonts';
import App from './App';

// Web-only: offline app shell + ask the browser not to evict downloaded books and dictionaries.
// The Android app has neither problem, and a SW in its WebView would pin stale builds.
if (!Capacitor.isNativePlatform()) {
  if (import.meta.env.PROD) {
    import('virtual:pwa-register')
      .then(({ registerSW }) => registerSW({ immediate: true }))
      .catch(() => { /* offline shell is best-effort */ });
  }
  void navigator.storage?.persist?.().catch(() => false);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
