# Hiragana Flashcards & Japanese Tutor

Two apps live here.

## Japanese Tutor (Linux app)

One window with a Claude tutor you can talk to, plus kana and vocab review, a dictionary, and progress tracking. Nothing comes from Google. Voice is free and runs offline on your computer.

Install or update (no sudo):

    curl -fsSL https://raw.githubusercontent.com/mrshmonke/hiragana-flashcards/main/install.sh | bash

Then open **Japanese Tutor** from the app launcher. If the installer says so, run `sudo apt install gir1.2-webkit2-4.1` once (it's the component the window is drawn with). Paste your own Claude API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) into Settings.

- **Tutor**: conversation, Okinawa role-play, drills, anime line breakdowns, or ask anything. Press 🎤 (or Ctrl+M) and talk in Japanese or English; it stops listening when you pause, and reads replies aloud. It corrects mistakes plainly and doesn't flatter. It logs mistakes and new words and keeps notes on your level.
- **Kana**: type the romaji, or **Trip Up** mode for look-alike kana in your set. Always shuffled.
- **Vocab**, **Dictionary**, **Progress** (streak, minutes, kana chart, mix-ups, mistakes, API spend, export/import).
- **Kana font**: Textbook (like a printed chart) or Variable (rotating styles).

### How it's built

- `hiragana.py` is the app: a GTK window with a WebKitGTK view. It falls back to the original GTK flashcards if WebKitGTK isn't installed. It updates itself from this repo (bump `APP_VERSION`); the UI and helper files are re-downloaded when the version changes.
- `docs/` is the UI (plain HTML/JS). It talks to Claude directly with your key (official Anthropic TypeScript SDK, vendored in `docs/vendor/`). Fonts are bundled in `docs/fonts/`.
- `voice-helper/jp_voice.py` runs only while the app is open, on 127.0.0.1:8770. It serves the UI and does speech: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) to hear you (model chosen in Settings: tiny/base for weak machines up to large-v3-turbo), Open JTalk (pyopenjtalk) for the Japanese voice, and Piper for English. It records from the microphone itself (parecord, arecord or pw-record).
- `voice-helper/setup-voice.sh` installs the voice parts into `~/.local/share/japanese-tutor/venv` using [uv](https://github.com/astral-sh/uv). About 1 GB on disk plus the Whisper model.
- To work on the UI in a browser: `cd docs && python3 -m http.server 8000`, and run `python3 voice-helper/jp_voice.py` for voice.

## iPhone app

Kana (typing and Trip Up), Vocab, Dictionary and Progress on your iPhone. No tutor. Works offline, no App Store, no Mac needed.

1. On the iPhone, open **https://mrshmonke.github.io/hiragana-flashcards/ios/** in Safari.
2. Tap Share, then **Add to Home Screen**. Open it from the new **Hiragana** icon.

Progress stays on the phone. To bring progress over from the Linux app, use Progress → Export there and Settings → Import progress on the phone (AirDrop or Files works for moving the file). The code is `docs/ios/`; it shares the word list and review scheduling (`docs/data.js`, `kana.js`, `store.js`) with the Linux app, so new words show up in both. Updates download in the background and appear on the next launch; bump `CACHE` in `docs/ios/sw.js` if you add files.

### Native iPhone app (TestFlight)

`ios-native/` wraps the same `docs/ios` flashcards in a small Swift app (a WKWebView that serves the files from inside the app), so it opens from its own icon and works with no signal and no Safari. Progress is also copied to the app's own files and put back if web storage is ever cleared.

No Mac needed: `.github/workflows/testflight.yml` builds it on GitHub's macOS runner with [XcodeGen](https://github.com/yonaskolb/XcodeGen) and uploads to TestFlight on every push to main that touches the app (or run it by hand from the Actions tab). Pull requests only check that it compiles. One-time setup:

- App ID `io.github.mrshmonke.hiragana` on developer.apple.com, and an app with that bundle ID in App Store Connect.
- An App Store Connect API key (Team Key, Admin role).
- Repository secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the whole .p8 file) and `APPLE_TEAM_ID`.

## Original flashcards (fallback)

If WebKitGTK isn't installed, `hiragana.py` opens the original GTK flashcards (Kana, Vocab, Dictionary) instead, with a note on how to get the tutor window.
