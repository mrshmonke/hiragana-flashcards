#!/usr/bin/env bash
# Copy the flashcards web app (docs/ios plus the files it shares with the
# Linux app) into ios-native/web, keeping the same folder layout.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docs="$here/../docs"
out="$here/web"
rm -rf "$out"
mkdir -p "$out/ios" "$out/fonts"
cp "$docs"/ios/{index.html,app.js,styles.css} "$out/ios/"
cp "$docs"/{store.js,kana.js,data.js,icon-192.png} "$out/"
cp "$docs"/fonts/*.woff2 "$docs"/fonts/fonts.css "$docs"/fonts/LICENSES.txt "$out/fonts/"
echo "Staged $(find "$out" -type f | wc -l) files in $out"
