// Speech in and out.
//
// Preferred: the free, offline voice helper running on this computer
// (voice-helper/jp_voice.py): Whisper for speech-to-text, Open JTalk for the
// Japanese voice, Piper for English. Works in any browser, including Firefox.
//
// Fallback: the browser's own Web Speech API, where it exists (Safari on
// iPhone, for example). Firefox has no speech recognition of its own.

// When the app is served by the helper itself (the Linux app window), talk to it
// on the same origin; otherwise (e.g. a browser) reach it on this computer.
const HELPER = location.port === "8770" ? "" : "http://127.0.0.1:8770";
const JP = /[぀-ヿ㐀-鿿ｦ-ﾟ　-〿！-～]/;
const BrowserRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const browserTTS = "speechSynthesis" in window;

export const status = { helper: null, checked: false }; // helper = /health JSON or null

export async function detect() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(HELPER + "/health", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    status.helper = r.ok ? await r.json() : null;
  } catch { status.helper = null; }
  status.checked = true;
  return status.helper;
}

export const canListen = () =>
  !!((status.helper?.stt && (status.helper.native_mic || navigator.mediaDevices?.getUserMedia)) || BrowserRec);
export const canSpeak = () => !!(status.helper?.tts_ja || browserTTS);
export const engineName = () =>
  status.helper ? "Voice helper (offline Whisper + Open JTalk)" : BrowserRec ? "Browser speech (online)" : "none";

export async function startSetup(model) {
  await fetch(`${HELPER}/setup/voice?model=${encodeURIComponent(model)}`, { method: "POST" });
}

/* ---------- browser voices (fallback) ---------- */
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
if (browserTTS) { loadVoices(); speechSynthesis.addEventListener?.("voiceschanged", loadVoices); }
function pickVoice(lang) {
  const list = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang));
  const pref = ["kyoko", "o-ren", "natural", "siri", "samantha", "daniel"];
  for (const p of pref) { const v = list.find((x) => x.name.toLowerCase().includes(p)); if (v) return v; }
  return list[0] || null;
}
export function hasJapaneseVoice() { return !!status.helper?.tts_ja || !!pickVoice("ja"); }

// Turn a tutor reply into speakable segments: drop markdown, drop romaji in
// brackets after Japanese (it sounds wrong read by either voice).
export function speakableSegments(text) {
  const t = text
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

/* ---------- speaking ---------- */
let speakToken = 0;
let currentAudio = null;
export function stopSpeaking() {
  speakToken++;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (browserTTS) speechSynthesis.cancel();
}

async function helperWav(text, lang, speed) {
  const r = await fetch(HELPER + "/tts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, speed }),
  });
  if (!r.ok) throw new Error("tts " + r.status);
  return URL.createObjectURL(await r.blob());
}

function playUrl(url, my) {
  return new Promise((resolve) => {
    if (my !== speakToken) return resolve();
    const a = new Audio(url);
    currentAudio = a;
    a.onended = a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    a.play().catch(() => resolve());
  });
}

function browserSay(text, ja, rate, my) {
  return new Promise((resolve) => {
    if (!browserTTS || my !== speakToken) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = ja ? "ja-JP" : "en-US";
    const v = pickVoice(ja ? "ja" : "en");
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// Speak a reply. Resolves when finished (or stopped).
export async function speak(text, { jaRate = 0.85, enRate = 1.0, onlyJapanese = false } = {}) {
  stopSpeaking();
  const my = ++speakToken;
  const segs = speakableSegments(text).filter((s) => !onlyJapanese || s.ja);
  const h = status.helper;
  // Start synthesizing every helper segment at once, then play in order.
  const jobs = segs.map((s) => {
    const viaHelper = s.ja ? h?.tts_ja : h?.tts_en;
    return viaHelper ? helperWav(s.text, s.ja ? "ja" : "en", s.ja ? jaRate : enRate).catch(() => null) : null;
  });
  for (let i = 0; i < segs.length; i++) {
    if (my !== speakToken) return;
    const url = jobs[i] ? await jobs[i] : null;
    if (url) await playUrl(url, my);
    else await browserSay(segs[i].text, segs[i].ja, segs[i].ja ? jaRate : enRate, my);
  }
}

/* ---------- listening ---------- */
let active = null; // { stop(), cancel() }

// Listen once. onStatus gets text to show ("Listening…", live words, …).
// Resolves with the final transcript ("" if nothing heard).
export function listen(lang, onStatus, { model = "small" } = {}) {
  stopListening(true);
  stopSpeaking();
  if (status.helper?.stt && status.helper.native_mic) return listenNative(lang, onStatus, model);
  if (status.helper?.stt) return listenHelper(lang, onStatus, model);
  if (BrowserRec) return listenBrowser(lang, onStatus);
  return Promise.reject(new Error("Voice input needs the free voice helper. Run the install command from the README, then press Check again in Settings."));
}

export function stopListening(cancel = false) {
  if (active) { const a = active; active = null; cancel ? a.cancel() : a.stop(); }
}

// The helper records from the microphone itself and stops when you pause.
async function listenNative(lang, onStatus, model) {
  const post = (path) => fetch(HELPER + path, { method: "POST" }).catch(() => {});
  active = { stop: () => post("/listen/stop"), cancel: () => post("/listen/cancel") };
  const labels = { listening: "Listening… (start talking)", hearing: "Listening… (stops when you pause)", transcribing: "Transcribing…" };
  let polling = true;
  (async () => {
    while (polling) {
      try { const r = await fetch(HELPER + "/listen/status", { cache: "no-store" }); const j = await r.json(); if (polling && labels[j.state]) onStatus?.(labels[j.state]); } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  })();
  try {
    onStatus?.(labels.listening);
    const r = await fetch(`${HELPER}/listen?lang=${lang.slice(0, 2)}&model=${encodeURIComponent(model)}`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Voice input failed");
    return (j.text || "").trim();
  } catch (e) {
    throw new Error(/fetch|network/i.test(e.message) ? "The voice helper stopped responding." : e.message);
  } finally {
    polling = false;
    active = null;
  }
}

async function listenHelper(lang, onStatus, model) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    throw new Error("Microphone access was blocked or no microphone was found. Allow the microphone for this page in the address bar.");
  }
  const types = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];
  const mime = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // Simple voice activity detection: stop after ~1.3 s of quiet once speech started.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let floor = 0, samples = 0, spoke = false, quietSince = 0, cancelled = false;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const cleanup = () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); };
    const finish = () => { if (rec.state !== "inactive") rec.stop(); };
    active = { stop: finish, cancel: () => { cancelled = true; finish(); } };
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (now - started < 300) { floor += rms; samples++; return; }
      const base = samples ? floor / samples : 0.005;
      const loud = rms > Math.max(0.012, base * 3);
      if (loud) { spoke = true; quietSince = 0; onStatus?.("Listening… (stops when you pause)"); }
      else if (spoke) { quietSince ||= now; if (now - quietSince > 1300) finish(); }
      if (!spoke && now - started > 8000) finish();   // nothing said
      if (now - started > 30000) finish();            // hard limit
    }, 50);
    rec.onstop = async () => {
      cleanup();
      if (active?.stop === finish) active = null;
      if (cancelled || !spoke) return resolve("");
      onStatus?.("Transcribing…");
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const r = await fetch(`${HELPER}/stt?lang=${lang.slice(0, 2)}&model=${encodeURIComponent(model)}`, { method: "POST", body: blob });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Transcription failed");
        resolve((j.text || "").trim());
      } catch (e) {
        reject(new Error(/fetch|network/i.test(e.message) ? "The voice helper stopped responding. Is it running?" : e.message));
      }
    };
    rec.start(250);
    onStatus?.("Listening… (start talking)");
  });
}

function listenBrowser(lang, onStatus) {
  return new Promise((resolve, reject) => {
    const r = new BrowserRec();
    active = { stop: () => r.stop(), cancel: () => r.abort() };
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = ""; finalText = "";
      for (const res of e.results) { if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript; }
      onStatus?.(finalText + interim, true);
    };
    r.onerror = (e) => {
      active = null;
      if (e.error === "no-speech" || e.error === "aborted") return resolve("");
      reject(new Error(e.error === "not-allowed" ? "Microphone access was blocked. Allow it in the address bar." : `Speech recognition error: ${e.error}`));
    };
    r.onend = () => { active = null; resolve(finalText.trim()); };
    r.start();
    onStatus?.("Listening…");
  });
}
