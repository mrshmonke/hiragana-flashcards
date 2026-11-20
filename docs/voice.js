// Speech in and out, using the browser's built-in Web Speech API.
// Recognition works in Google Chrome (and Edge, Safari). Firefox has none.

const JP = /[぀-ヿ㐀-鿿ｦ-ﾟ　-〿！-～]/;

let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

function pickVoice(lang) {
  const list = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang));
  // Prefer natural-sounding voices when available.
  const pref = ["google", "kyoko", "o-ren", "natural", "online", "siri", "samantha"];
  for (const p of pref) {
    const v = list.find((x) => x.name.toLowerCase().includes(p));
    if (v) return v;
  }
  return list[0] || null;
}

export function hasJapaneseVoice() { return !!pickVoice("ja"); }
export const canSpeak = "speechSynthesis" in window;
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!Rec;

// Turn a tutor reply into plain speakable segments: drop markdown, drop
// romaji in brackets after Japanese (it sounds wrong read by either voice).
export function speakableSegments(text) {
  let t = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`|~]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[(（]\s*[A-Za-zāīūēōĀĪŪĒŌ' .,!?\-]+\s*[)）]/g, " ")
    .replace(/^\s*[-•]\s+/gm, "");
  const segs = [];
  let cur = "", curJa = null;
  for (const ch of t) {
    const isJa = JP.test(ch);
    const neutral = /[\s0-9.,!?:;"'、。「」…\-]/.test(ch);
    if (neutral || isJa === curJa) { cur += ch; continue; }
    if (curJa === null) { curJa = isJa; cur += ch; continue; }
    if (cur.trim()) segs.push({ ja: curJa, text: cur.trim() });
    cur = ch; curJa = isJa;
  }
  if (cur.trim()) segs.push({ ja: !!curJa, text: cur.trim() });
  return segs.filter((s) => /[\p{L}\p{N}]/u.test(s.text));
}

let speakToken = 0;
export function stopSpeaking() { speakToken++; if (canSpeak) speechSynthesis.cancel(); }

// Speak a reply. Resolves when finished (or stopped).
export function speak(text, { jaRate = 0.85, enRate = 1.0, onlyJapanese = false } = {}) {
  if (!canSpeak) return Promise.resolve();
  stopSpeaking();
  const my = ++speakToken;
  const segs = speakableSegments(text).filter((s) => !onlyJapanese || s.ja);
  const ja = pickVoice("ja"), en = pickVoice("en");
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (my !== speakToken || i >= segs.length) return resolve();
      const s = segs[i++];
      const u = new SpeechSynthesisUtterance(s.text);
      u.lang = s.ja ? "ja-JP" : "en-US";
      const v = s.ja ? ja : en;
      if (v) u.voice = v;
      u.rate = s.ja ? jaRate : enRate;
      u.onend = next;
      u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  });
}

// One-shot listening. onPartial gets live text; resolves with the final text
// ("" if nothing heard). Rejects with a readable message on errors.
let active = null;
export function listen(lang, onPartial) {
  if (!Rec) return Promise.reject(new Error("Speech recognition isn't available in this browser. Use Google Chrome."));
  stopListening();
  stopSpeaking();
  return new Promise((resolve, reject) => {
    const r = new Rec();
    active = r;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (const res of e.results) {
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onPartial?.(finalText + interim);
    };
    r.onerror = (e) => {
      active = null;
      const msg = {
        "not-allowed": "Microphone access was blocked. Allow the microphone for this page in Chrome's address bar.",
        "service-not-allowed": "Microphone access was blocked. Allow the microphone for this page in Chrome's address bar.",
        "network": "Speech recognition needs the internet, and this browser's speech service didn't respond. On Linux it only works in Google Chrome, not Chromium or Firefox.",
        "audio-capture": "No microphone was found.",
      }[e.error];
      if (e.error === "no-speech" || e.error === "aborted") resolve("");
      else reject(new Error(msg || `Speech recognition error: ${e.error}`));
    };
    r.onend = () => { active = null; resolve(finalText.trim()); };
    r.start();
  });
}

export function stopListening() {
  if (active) { try { active.stop(); } catch {} active = null; }
}
