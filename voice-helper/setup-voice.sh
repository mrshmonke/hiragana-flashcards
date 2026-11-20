#!/usr/bin/env bash
# Sets up offline voice for Japanese Tutor (no sudo):
#   - uv (a small Python package installer) in ~/.local/share/japanese-tutor/bin
#   - a private Python environment with faster-whisper, pyopenjtalk and piper
#   - the English Piper voice and one Whisper model
# Safe to rerun. Usage: setup-voice.sh [whisper-model]   (default: small)
set -euo pipefail
HOME_DIR="$HOME/.local/share/japanese-tutor"
MODEL="${1:-small}"
BIN="$HOME_DIR/bin"
VENV="$HOME_DIR/venv"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$BIN" "$HOME_DIR/models/piper"

step() { echo "STEP: $*"; }

UV="$(command -v uv || true)"
if [ -z "$UV" ]; then
  UV="$BIN/uv"
  if [ ! -x "$UV" ]; then
    step "Downloading the package installer (uv)"
    ARCH="$(uname -m)"
    curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-${ARCH}-unknown-linux-gnu.tar.gz" \
      | tar -xz -C "$BIN" --strip-components=1
  fi
fi

if [ ! -x "$VENV/bin/python" ]; then
  step "Creating the voice environment"
  "$UV" venv --quiet --python /usr/bin/python3 "$VENV" || "$UV" venv --quiet "$VENV"
fi

step "Installing speech recognition and voices (the biggest step)"
"$UV" pip install --quiet --python "$VENV/bin/python" -r "$HERE/requirements.txt"

if [ ! -f "$HOME_DIR/models/piper/en_US-lessac-medium.onnx" ]; then
  step "Downloading the English voice"
  "$VENV/bin/python" -m piper.download_voices en_US-lessac-medium --data-dir "$HOME_DIR/models/piper" \
    || echo "(English voice download failed; English will use the system voice.)"
fi

step "Downloading the Whisper '$MODEL' speech model"
JP_VOICE_HOME="$HOME_DIR" "$VENV/bin/python" "$HERE/jp_voice.py" --download "$MODEL"

step "Done"
