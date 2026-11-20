#!/usr/bin/env bash
# Old install command; the tutor is now part of the main app. Runs install.sh.
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/mrshmonke/hiragana-flashcards/main/install.sh | bash -s -- "$@"
