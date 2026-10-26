# 09 — Android app

The Android app is the same web build wrapped by Capacitor (`frontend/android/`, app id `xyz.apicov.reader`).
It talks to `https://books.apicov.xyz` (`frontend/.env.production`). Differences from the web app:

- Books are files in the app's data folder, downloaded natively (`@capacitor/file-transfer`).
- Dictionaries are SQLite databases (`@capacitor-community/sqlite`): the plugin downloads each dictionary's
  zip and unzips `<id>SQLite.db` into its database folder.
- Requests go through CapacitorHttp, so CORS doesn't apply; connectivity comes from `@capacitor/network`.
- No service worker.
- Android 10 and older: the FileTransfer plugin asks for the storage permission before any download (even into
  the app's own folder), so the manifest declares `READ/WRITE_EXTERNAL_STORAGE` with `maxSdkVersion="29"`; the
  phone asks once, at the first download. Newer Android never asks.

## Build tools

- JDK 21 (Gradle doesn't run on newer JDKs): `dnf install java-21-openjdk-devel`, used through `JAVA_HOME`.
- Android SDK (Android Studio, or the command-line tools) with platform 35; `ANDROID_HOME` set
  (e.g. `~/Android/Sdk`).

## Build and install

With the phone connected (USB debugging on, the computer allowed on the phone):

```bash
cd frontend
npm ci                         # once, and after dependency changes
./rebuild-prod.sh              # debug APK against the production API, installed on the phone
./rebuild-prod.sh --no-install # build only → android/app/build/outputs/apk/debug/app-debug.apk
```

`rebuild-prod.sh` reads the API address from `.env.production`, builds the web app, syncs it into the
Android project (`npx cap sync`), builds the APK with JDK 21 and installs it with `adb install -r`, which
keeps the app's data (downloaded books, dictionaries, sign-in).

## Native code

`MainActivity.java` is Capacitor's activity with one change: Android's floating menu over selected text (Copy,
Share, Select all) is emptied, so it doesn't show; the app's own panel (translate, highlight, copy, …) takes its
place. The WebView sits in a small holder whose `startActionModeForChild` passes Android an empty menu.
- **Why not the activity hook:** the activity's `onWindowStartingActionMode` can't do it, because for a floating
  menu Android builds it from the original callback.
- **When it's emptied:** the WebView fills the menu while preparing it, not when creating it, so both are
  emptied.

## Icons and launch screen

`frontend/scripts/make_icons.py` draws the app icon (web icons, Android launcher icons, adaptive-icon
foregrounds and launch screens) from one drawing. Run it from `frontend/` with Pillow installed after
`npx cap add android` or when the design changes.

## Release build

A release APK is signed with a keystore that lives outside the repo, in `~/tsp-configs/pico-reader/`. Create
it once:

```bash
cd frontend/android
./create-keystore.sh           # asks for a password; writes the keystore and android/key.properties
```

`key.properties` (git-ignored, with a copy next to the keystore) tells Gradle where the keystore is. Then:

```bash
cd frontend
./rebuild-prod.sh --release    # → android/app/build/outputs/apk/release/app-release.apk, installed
```

Keep the keystore and its password: every later version must be signed with the same key, or the phone
refuses the update. Debug and release builds are signed differently, so switching a phone from one to the
other needs `adb uninstall xyz.apicov.reader` first, which deletes the app's downloads.

## Debugging

Debug builds allow WebView debugging: with the phone connected, open `chrome://inspect` in Chrome on the
computer and inspect the app's WebView (console, network, storage).
