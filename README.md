# Hiragana Flashcards & Japanese Tutor

Two apps live here.

## Japanese Tutor (web app, Linux first)

A Claude-powered Japanese tutor you can talk to, plus kana and vocab review and progress tracking. It's in [`docs/`](docs/) and is served at https://mrshmonke.github.io/hiragana-flashcards/.

- **Tutor**: conversation, Okinawa role-play, kana/vocab drills, anime line breakdowns, or ask anything. Press 🎤 (or Ctrl+M) and speak Japanese or English; replies are read aloud. The tutor corrects mistakes plainly and doesn't flatter. It logs your mistakes and new words to your progress and keeps notes on your level for future sessions.
- **Kana**: type the romaji for each hiragana. Spaced repetition decides what comes back and when.
- **Vocab**: ~320 words, limited to the kana you've picked, plus words the tutor taught you.
- **Progress**: streak, daily minutes, which kana are solid, logged mistakes, tutor notes, estimated API spend, and export/import.

Needs **Google Chrome** on Linux (Chromium and Firefox lack working speech recognition) and your own Claude API key from [console.anthropic.com](https://console.anthropic.com/settings/keys), entered in Settings. The key and your progress stay in that browser.

Add it to your app launcher (no sudo):

    curl -fsSL https://raw.githubusercontent.com/mrshmonke/hiragana-flashcards/main/install-tutor.sh | bash

Or open the URL in Chrome and use the install icon in the address bar.

To run locally: `cd docs && python3 -m http.server 8000`, then open http://localhost:8000.

`docs/data.js` is generated from the word list in `hiragana.py`. `docs/vendor/` holds a browser bundle of the official Anthropic TypeScript SDK (v1.11.0).

## Hiragana Flashcards (GTK desktop app)

A small GTK app for Ubuntu: kana flashcards, vocab flashcards limited to the kana you've studied, and a beginner dictionary.

Install (no sudo):

    curl -fsSL https://raw.githubusercontent.com/mrshmonke/hiragana-flashcards/main/install.sh | bash

The app checks this repo at launch and shows an "Update ready" button when `APP_VERSION` in `hiragana.py` goes up.
