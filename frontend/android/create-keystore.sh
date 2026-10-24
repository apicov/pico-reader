#!/bin/bash
# Create the keystore that signs release builds, and android/key.properties pointing at it.
# The keystore lives outside the repo (~/tsp-configs/pico-reader/). Keep it and its passwords safe:
# every future update of the installed app must be signed with the same key.
set -e

DIR="$HOME/tsp-configs/pico-reader"
KEYSTORE="$DIR/pico-reader-release.jks"
ALIAS="pico-reader"
PROPS="$(cd "$(dirname "$0")" && pwd)/key.properties"

if [ -f "$KEYSTORE" ]; then
    echo "❌ $KEYSTORE already exists; not overwriting it."
    exit 1
fi
mkdir -p "$DIR"
chmod 700 "$DIR"

read -r -s -p "Keystore password (6+ characters): " PASSWORD; echo
read -r -s -p "Repeat it: " AGAIN; echo
[ "$PASSWORD" = "$AGAIN" ] || { echo "❌ The passwords differ."; exit 1; }

keytool -genkeypair -v -keystore "$KEYSTORE" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASSWORD" -keypass "$PASSWORD" -dname "CN=Pico Reader"
chmod 600 "$KEYSTORE"

umask 077
cat > "$PROPS" <<PROPS
storeFile=$KEYSTORE
storePassword=$PASSWORD
keyAlias=$ALIAS
keyPassword=$PASSWORD
PROPS
cp "$PROPS" "$DIR/key.properties"

echo ""
echo "✅ Keystore: $KEYSTORE"
echo "✅ Signing settings: $PROPS (copy in $DIR/key.properties)"
echo "   ./rebuild-prod.sh --release now builds a signed APK."
