# 06 — Web app

The frontend is built on the server and copied to the web root.

## Settings

`frontend/.env.production` (in the repo, no secrets):

```
VITE_API_URL=https://books.apicov.xyz
```

The Android app uses the same value: it calls the API by its full address.

## Build and publish

As tsp:

```bash
cd ~/code/pico-reader/frontend
npm ci
npm run build:web
sudo rsync -a --delete dist/ /var/www/pico-reader/
sudo restorecon -R /var/www/pico-reader
```

`build:web` gives Node a 2 GB heap (`NODE_OPTIONS` in `package.json`): bundling mermaid needs more than the
default ~1 GB, and on the 2 GB server the rest comes from swap. If the build stops with "JavaScript heap out of
memory", `dist/` is incomplete (no `sw.js`): don't publish it.

`restorecon` gives the files the label Apache may read. Open `https://books.apicov.xyz`, sign in with an
allowlisted email ([04](04-backend.md) §7).

## What the build contains

- `polyfills.ts` (core-js) and `build.target: es2017`: the app also runs in older Android WebViews.
- A service worker (vite-plugin-pwa) that caches the app shell, so the web app opens offline. It is registered
  on the web only, never inside the Android app. It controls the page from the first visit (`clientsClaim`).
- What the service worker doesn't fetch on install, but keeps once used: the ONNX runtime for offline search
  (`/ort/`), and the diagram library (mermaid, ~3 MB). `vite.config.ts` (`findDiagramChunks`) leaves out of the
  precache the chunks reachable only through `import('mermaid')`; anything the rest of the app also uses (katex)
  stays in.
- Fonts (Literata, Inter) bundled with every character set, so German, Portuguese, Spanish, French, Greek
  and Cyrillic text renders offline.
