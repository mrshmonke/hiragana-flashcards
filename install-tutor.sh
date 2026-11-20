#!/usr/bin/env bash
# Adds "Japanese Tutor" to your Ubuntu app launcher. It opens the web app
# in its own Google Chrome window. No sudo needed.
set -euo pipefail
URL="https://mrshmonke.github.io/hiragana-flashcards/"
ICON_URL="${URL}icon-512.png"
DIR="$HOME/.local/share/japanese-tutor"
APPS="$HOME/.local/share/applications"

CHROME=""
for c in google-chrome google-chrome-stable; do
  if command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "Google Chrome isn't installed. The tutor needs it for speech recognition and Japanese voices."
  echo "Install it from https://www.google.com/chrome/ (download the .deb, then open it), and run this again."
  exit 1
fi

mkdir -p "$DIR" "$APPS"
curl -fsSL "$ICON_URL" -o "$DIR/icon.png" || echo "(Couldn't download the icon; the launcher will still work.)"

cat > "$APPS/japanese-tutor.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Japanese Tutor
Comment=Talk with a Claude Japanese tutor and review kana and vocab
Exec=$CHROME --app=$URL --class=JapaneseTutor
Icon=$DIR/icon.png
Terminal=false
Categories=Education;Languages;
StartupWMClass=JapaneseTutor
DESK
chmod +x "$APPS/japanese-tutor.desktop"
update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Installed. Open \"Japanese Tutor\" from your app launcher (press the Super key and type Japanese)."
