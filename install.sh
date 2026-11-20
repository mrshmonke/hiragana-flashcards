#!/bin/bash
# Installs Japanese Tutor for this user (no sudo needed). Safe to rerun.
#   curl -fsSL https://raw.githubusercontent.com/mrshmonke/hiragana-flashcards/main/install.sh | bash
# One app window: Claude tutor you can talk to, kana, vocab, dictionary, progress.
# Voice is free and offline (Whisper, Open JTalk, Piper). Nothing from Google.
# Optional first argument: Whisper model (tiny, base, small, medium, large-v3-turbo).
set -euo pipefail
MODEL="${1:-small}"
APP_DIR="$HOME/.local/share/hiragana-flashcards"      # the app (kept for self-update)
TUTOR="$HOME/.local/share/japanese-tutor"             # tutor UI, voice helper, models
TARBALL="https://codeload.github.com/mrshmonke/hiragana-flashcards/tar.gz/refs/heads/main"
mkdir -p "$APP_DIR" "$TUTOR" "$HOME/.local/share/applications" "$HOME/.local/share/fonts"

echo "1/4  Downloading the app..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$TARBALL" | tar -xz -C "$TMP"
SRC="$(echo "$TMP"/*)"
install -m 755 "$SRC/hiragana.py" "$APP_DIR/hiragana.py"
rm -rf "$TUTOR/app" "$TUTOR/voice-helper"
cp -r "$SRC/docs" "$TUTOR/app"
cp -r "$SRC/voice-helper" "$TUTOR/voice-helper"
sed -n 's/^APP_VERSION = \([0-9]*\).*/\1/p' "$SRC/hiragana.py" > "$TUTOR/app-version"
# Textbook-style kana font for the fallback flashcard screen
if [ ! -f "$HOME/.local/share/fonts/KleeOne-SemiBold.ttf" ]; then
  curl -fsSL https://raw.githubusercontent.com/google/fonts/main/ofl/kleeone/KleeOne-SemiBold.ttf \
    -o "$HOME/.local/share/fonts/KleeOne-SemiBold.ttf" && fc-cache -f "$HOME/.local/share/fonts" >/dev/null 2>&1 || true
fi

echo "2/4  Adding it to your app launcher..."
cp "$TUTOR/app/icon-512.png" "$TUTOR/icon.png"
rm -f "$HOME/.local/share/applications/japanese-tutor.desktop"   # older Chrome launcher
cat > "$HOME/.local/share/applications/hiragana-flashcards.desktop" <<DEOF
[Desktop Entry]
Type=Application
Name=Japanese Tutor
Comment=Talk with a Claude Japanese tutor; kana, vocab and dictionary practice
Exec=/usr/bin/python3 $APP_DIR/hiragana.py
Icon=$TUTOR/icon.png
Terminal=false
Categories=Education;Languages;
DEOF
update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true

echo "3/4  Setting up offline voice (about 1 GB, a few minutes the first time)..."
if ! bash "$TUTOR/voice-helper/setup-voice.sh" "$MODEL"; then
  echo "     Voice setup didn't finish. The tutor still works by typing; you can"
  echo "     retry from Settings > Voice > Install voice inside the app."
fi

echo "4/4  Checking for the window component (WebKitGTK)..."
if /usr/bin/python3 -c 'import gi; gi.require_version("WebKit2", "4.1")' 2>/dev/null \
   || /usr/bin/python3 -c 'import gi; gi.require_version("WebKit2", "4.0")' 2>/dev/null; then
  echo "     OK"
else
  echo
  echo "  One more step: the tutor window needs WebKitGTK. Run this once:"
  echo "      sudo apt install gir1.2-webkit2-4.1"
  echo "  Until then the app opens as the plain flashcards."
  echo
fi

echo "Installed. Open \"Japanese Tutor\" from your app launcher (Super key, type Japanese)."
nohup /usr/bin/python3 "$APP_DIR/hiragana.py" >/dev/null 2>&1 &
