# 09 — Android app

The Android app is the same web build wrapped by Capacitor (`frontend/android/`, app id `xyz.apicov.reader`).
It talks to `https://books.apicov.xyz` (`frontend/.env.production`). Differences from the web app:

- Books are files in the app's data folder, downloaded natively (`@capacitor/file-transfer`).
- Dictionaries are SQLite databases (`@capacitor-community/sqlite`): the plugin downloads each dictionary's
  zip and unzips `<id>SQLite.db` into its database folder.
- Requests go through CapacitorHttp, so CORS doesn't apply; connectivity comes from `@capacitor/network`.
- No service worker.

## Build tools

- JDK 21 (Gradle doesn't run on newer JDKs): `dnf install java-21-openjdk-devel`, used through `JAVA_HOME`.
- Android SDK (Android Studio, or the command-line tools) with platform 35; `ANDROID_HOME` set
  (e.g. `~/Android/Sdk`).

## Build a debug APK

```bash
cd frontend
npm ci
npm run build                        # web build + npx cap sync
cd android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Install on a phone with USB debugging on:
`~/Android/Sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## Icons and launch screen

`frontend/scripts/make_icons.py` draws the app icon (web icons, Android launcher icons, adaptive-icon
foregrounds and launch screens) from one drawing. Run it from `frontend/` with Pillow installed after
`npx cap add android` or when the design changes.

## Release build

A signed release needs a keystore (keep it outside the repo, with a copy in `~/tsp-configs/pico-reader/`):

```bash
keytool -genkey -v -keystore pico-reader.jks -alias pico-reader -keyalg RSA -keysize 2048 -validity 10000
cd frontend/android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=$HOME/tsp-configs/pico-reader/pico-reader.jks \
  -Pandroid.injected.signing.store.password=… -Pandroid.injected.signing.key.alias=pico-reader \
  -Pandroid.injected.signing.key.password=…
```

## Debugging

Debug builds allow WebView debugging: with the phone connected, open `chrome://inspect` in Chrome on the
computer and inspect the app's WebView (console, network, storage).
