#!/bin/bash
# Build the Android app against the production backend and install it on the connected phone.
# Backend URL is read from .env.production (VITE_API_URL). Adapted from the_stitch_tracker.
#
# Usage:
#   ./rebuild-prod.sh             # debug APK (default, for testing)
#   ./rebuild-prod.sh --release   # signed release APK (needs android/key.properties: android/create-keystore.sh)
#   ./rebuild-prod.sh --no-install
#   ./rebuild-prod.sh --help

set -e
cd "$(dirname "$0")"

BUILD_TYPE="debug"
INSTALL=true

for arg in "$@"; do
    case $arg in
        --release|-r) BUILD_TYPE="release" ;;
        --no-install|-n) INSTALL=false ;;
        --help|-h)
            echo "Usage: ./rebuild-prod.sh [--release] [--no-install]"
            echo ""
            echo "Build Pico Reader for Android with the production backend and install it on the phone (USB debugging on)."
            echo ""
            echo "  --release, -r      signed release APK (android/key.properties; create it with android/create-keystore.sh)"
            echo "  --no-install, -n   build only"
            echo ""
            echo "Debug and release builds have different signatures: switching between them on a phone needs an"
            echo "uninstall first (adb uninstall xyz.apicov.reader), which removes downloaded books and dictionaries."
            exit 0
            ;;
        *)
            echo "❌ Unknown option: $arg (see --help)"
            exit 1
            ;;
    esac
done

API_URL=$(grep '^VITE_API_URL=' .env.production 2>/dev/null | cut -d= -f2-)
if [ -z "$API_URL" ]; then
    echo "❌ VITE_API_URL is missing or empty in .env.production — the app would call https://localhost/api and fail."
    exit 1
fi

# Gradle needs JDK 21 (newer JDKs are too new for it); the Android SDK gives adb
if [ -z "$JAVA_HOME" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21'; then
    for candidate in /usr/lib/jvm/java-21-openjdk /usr/lib/jvm/java-21 /usr/lib/jvm/temurin-21-jdk; do
        if [ -x "$candidate/bin/java" ]; then export JAVA_HOME="$candidate"; break; fi
    done
fi
"$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"21' || { echo "❌ JDK 21 not found (dnf install java-21-openjdk-devel)"; exit 1; }
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
ADB="$(command -v adb || echo "$ANDROID_HOME/platform-tools/adb")"

if [ "$BUILD_TYPE" = "release" ] && [ ! -f android/key.properties ]; then
    echo "❌ Release build requested but android/key.properties is missing."
    echo "   Create the keystore once: ./android/create-keystore.sh"
    echo "   (or build a debug APK: ./rebuild-prod.sh)"
    exit 1
fi

if [ "$INSTALL" = true ] && ! "$ADB" devices | grep -qw "device$"; then
    echo "❌ No phone connected (USB debugging on, and the computer allowed on the phone)."
    echo "   Check with: $ADB devices    — or build only: ./rebuild-prod.sh --no-install"
    exit 1
fi

echo "🔧 Rebuilding Pico Reader for PRODUCTION"
echo "🌐 API URL: $API_URL"
echo "📦 Build type: $BUILD_TYPE"
echo ""

# vite build runs in production mode (loads .env.production); `npm run build` ends with `npx cap sync`
echo "📦 Building the web app and syncing it into the Android project..."
npm run build

echo "📱 Building the APK..."
cd android
if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
    ./gradlew assembleDebug
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi
echo "✅ $(pwd)/$APK_PATH"

if [ "$INSTALL" = true ]; then
    echo "📲 Installing on the phone (keeps downloaded books, dictionaries and the sign-in)..."
    "$ADB" install -r -d "$APK_PATH"
fi
cd - > /dev/null

echo ""
echo "Done. Backend check from the phone's browser: $API_URL/health"
