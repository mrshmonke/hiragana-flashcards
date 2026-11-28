import { db, save, saveNow, today, activity, streak, grade, pickNext, countDue, exportJSON, importJSON, MASTERED_BOX } from "./store.js";
import { GROUPS, KANA, VOCAB, readable, romajiMatches, lookalikesIn } from "./kana.js";
import { MODELS, MODES, newSession, send, costSoFar, extractLeakedCalls } from "./tutor.js";
import * as voice from "./voice.js";
import { mountLessons } from "./lessons-ui.js";

const VERSION = "11";
const $ = (id) => document.getElementById(id);
const S = db.settings;

/* ---------- tabs ---------- */
let currentTab = "tutor";
function showTab(name) {
  currentTab = name;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === name));
  if (name === "progress") renderProgress();
  if (name === "kana") showKanaMode();
  if (name === "vocab" && !vCur) nextVocab();
  if (name === "dict") { renderDict(); setTimeout(() => $("dictSearch").focus(), 0); }
  if (name === "tutor") refreshKeyBanner();
  if (name === "lessons") lessons?.show();
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });
document.addEventListener("click", (e) => { const a = e.target.closest("[data-goto]"); if (a) { e.preventDefault(); showTab(a.dataset.goto); } });

/* ---------- tiny markdown ---------- */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const JP_RUN = /([぀-ヿ㐀-鿿　-〿！-～]+)/g;
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(JP_RUN, '<span class="jp">$1</span>');
}
function md(text) {
  const out = []; let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { if (!list) { list = []; } list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    if (!line.trim()) continue;
    const h = line.match(/^#+\s+(.*)$/);
    out.push(`<p>${h ? `<b>${inline(h[1])}</b>` : inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);
  return out.join("");
}

/* ---------- kana fonts ---------- */
// Textbook mode always uses the chart-style font. Variable mode gives each
// flashcard a different style, so kana stay readable in menus, signs, manga...
const FONTS = [
  { name: "Textbook", family: '"Klee One"' },
  { name: "Mincho (serif, books and signs)", family: '"Noto Serif JP"' },
  { name: "Gothic (sans, screens and menus)", family: '"Noto Sans JP"' },
  { name: "Rounded", family: '"Kosugi Maru"' },
  { name: "Handwritten", family: '"Yomogi"' },
  { name: "Brush pen", family: '"Zen Kurenaido"' },
  { name: "Pixel (game text)", family: '"DotGothic16"' },
];
let lastFont = 0;
function randomFontIndex() {
  let i;
  do { i = Math.floor(Math.random() * FONTS.length); } while (i === lastFont && FONTS.length > 1);
  lastFont = i;
  return i;
}
function applyCardFont(el, labelEl) {
  if (S.fontMode !== "variable") { el.style.fontFamily = ""; el.style.fontWeight = ""; labelEl.textContent = ""; return; }
  const i = randomFontIndex();
  el.style.fontFamily = `${FONTS[i].family}, var(--jp)`;
  el.style.fontWeight = i === 0 ? "" : "400"; // only the textbook font is loaded in a heavier weight
  labelEl.textContent = FONTS[i].name;
}

/* ---------- hiragana chart ---------- */
// Readings that break their row's pattern get an asterisk, like a textbook chart.
const IRREGULAR = new Set(["shi", "chi", "tsu"]);
const romajiHTML = (r) => (IRREGULAR.has(r) ? `<sup>*</sup>${r}` : esc(r));
// Place each row's kana in its column (a i u e o), leaving gaps like a real chart.
const COLS = { a: 0, i: 1, u: 2, e: 3, o: 4 };
function chartHTML(groupNames, withMastery) {
  const cell = (k, r) => {
    let cls = "";
    if (withMastery) {
      const it = db.items["kana:" + k];
      cls = !it ? "" : it.box >= MASTERED_BOX ? "b4" : it.box >= 2 ? "b2" : "b1";
    }
    const tip = withMastery && db.items["kana:" + k] ? ` title="${db.items["kana:" + k].right}✓ ${db.items["kana:" + k].wrong}✗"` : "";
    return `<div class="cell ${cls}"${tip}><span class="k">${k}</span><span class="r">${romajiHTML(r)}</span></div>`;
  };
  const blank = '<div class="cell"></div>';
  const basic = [], combo = [];
  for (const g of GROUPS.filter((x) => groupNames.includes(x.name))) {
    if (g.name.startsWith("Combos")) { for (const [k, r] of g.cards) combo.push(cell(k, r)); continue; }
    if (g.cards.length === 5) { basic.push(...g.cards.map(([k, r]) => cell(k, r))); continue; }
    // Short rows (Y, W + n): put kana under their vowel column.
    const row = [blank, blank, blank, blank, blank];
    const extra = [];
    for (const [k, r] of g.cards) {
      if (r === "n") { extra.push(cell(k, r)); continue; }
      row[COLS[r.at(-1)]] = cell(k, r);
    }
    basic.push(...row);
    if (extra.length) basic.push(...extra, blank, blank, blank, blank);
  }
  return (basic.length ? `<div class="chart">${basic.join("")}</div>` : "")
    + (combo.length ? `<div class="chart-title">Combinations</div><div class="chart combo">${combo.join("")}</div>` : "");
}

/* ---------- tutor ---------- */
const log = $("log");
let session = null;
let busy = false;
let abortCtl = null;

for (const [id, m] of Object.entries(MODES)) $("mode").add(new Option(m.label, id));

function addMsg(kind, text, { speakable = false } = {}) {
  const d = document.createElement("div");
  d.className = "msg " + kind;
  setMsg(d, text, speakable);
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}
function setMsg(d, text, speakable) {
  d.innerHTML = (speakable ? '<button class="say" title="Read aloud">🔊</button>' : "") + (d.classList.contains("me") || d.classList.contains("note") ? `<p>${inline(text)}</p>` : md(text));
  d.dataset.text = text;
}
log.addEventListener("click", (e) => {
  const b = e.target.closest(".say");
  if (b) voice.speak(b.parentElement.dataset.text, speakOpts());
});

function renderSession() {
  log.innerHTML = "";
  if (!session) { addMsg("note", "Pick a session type above and press New session, or just start talking."); return; }
  addMsg("note", `${MODES[session.mode]?.label || "Session"} · ${new Date(session.started).toLocaleString()}`);
  // One bubble per reply, even when a reply spanned several tool-use rounds.
  let reply = "";
  const flush = () => { if (reply.trim()) addMsg("them", reply, { speakable: voice.canSpeak() }); reply = ""; };
  for (const m of session.messages) {
    if (m.role === "user" && typeof m.content === "string") {
      flush();
      if (!m.content.startsWith("(Session start)")) addMsg("me", m.content.replace(/^\[spoken\] /, "🎤 "));
    } else if (m.role === "assistant") {
      const t = extractLeakedCalls(m.content.filter((b) => b.type === "text").map((b) => b.text).join("")).clean;
      if (t.trim()) reply += (reply ? "\n\n" : "") + t;
    }
  }
  flush();
}

function refreshKeyBanner() { $("keyBanner").classList.toggle("hidden", !!S.apiKey.trim()); }
function refreshSpend() { $("spend").textContent = db.usage.cost ? `≈ $${costSoFar().toFixed(2)} spent so far` : ""; }

function setBusy(b) {
  busy = b;
  $("sendBtn").classList.toggle("hidden", b);
  $("stopBtn").classList.toggle("hidden", !b);
  $("input").disabled = b;
}

async function talk(userText, { spoken = false, hidden = false } = {}) {
  if (busy || !userText.trim()) return;
  if (!S.apiKey.trim()) { refreshKeyBanner(); showTab("settings"); $("apiKey").focus(); return; }
  if (!session) startSession(false);
  const content = (spoken ? "[spoken] " : "") + userText.trim();
  if (!hidden) addMsg("me", spoken ? "🎤 " + userText.trim() : userText.trim());
  activity("msg");
  setBusy(true);
  abortCtl = new AbortController();
  const bubble = addMsg("them", "");
  bubble.classList.add("typing");
  try {
    const reply = await send(session, content, {
      signal: abortCtl.signal,
      onText: (t) => { setMsg(bubble, t, false); bubble.classList.add("typing"); log.scrollTop = log.scrollHeight; },
    });
    bubble.classList.remove("typing");
    setMsg(bubble, reply || "_(no reply)_", voice.canSpeak());
    activity("msg");
    setBusy(false);
    if (S.speakReplies && reply) {
      $("voiceStatus").textContent = "Speaking…";
      await voice.speak(reply, speakOpts());
      $("voiceStatus").textContent = "";
      if (S.handsFree && currentTab === "tutor" && !busy) startListening();
    }
  } catch (e) {
    bubble.remove();
    addMsg("err", e.message);
    setBusy(false);
  } finally {
    refreshSpend();
  }
}

function startSession(kickoff = true) {
  voice.stopSpeaking();
  const mode = $("mode").value;
  session = newSession(mode);
  renderSession();
  const start = MODES[mode].start;
  if (kickoff && start && S.apiKey.trim()) {
    talk(`(Session start) ${start}`, { hidden: true });
  }
}

$("newSession").onclick = () => startSession(true);
$("sendBtn").onclick = () => { const t = $("input").value; $("input").value = ""; autoGrow(); talk(t); };
$("stopBtn").onclick = () => { abortCtl?.abort(); voice.stopSpeaking(); };
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("sendBtn").click(); }
});
function autoGrow() { const t = $("input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
$("input").addEventListener("input", autoGrow);

// Voice input
let listening = false, listenCancelled = false;
async function startListening() {
  if (busy) return;
  if (listening) { voice.stopListening(); return; }   // pressing 🎤 again = done talking
  listening = true;
  listenCancelled = false;
  $("mic").classList.add("listening");
  $("cancelVoice").classList.remove("hidden");
  $("voiceStatus").textContent = S.micLang === "ja-JP" ? "Listening (日本語)…" : "Listening (English)…";
  try {
    const text = await voice.listen(S.micLang, (t, live) => {
      if (live) { $("input").value = t; autoGrow(); } else $("voiceStatus").textContent = t;
    }, { model: S.sttModel });
    $("input").value = ""; autoGrow();
    $("voiceStatus").textContent = "";
    if (listenCancelled) $("voiceStatus").textContent = "Cancelled.";
    else if (text) talk(text, { spoken: true });
    else $("voiceStatus").textContent = "Didn't catch anything.";
  } catch (e) {
    $("voiceStatus").textContent = "";
    addMsg("err", e.message);
  } finally {
    listening = false;
    $("mic").classList.remove("listening");
    $("cancelVoice").classList.add("hidden");
  }
}
function cancelListening() {
  if (!listening) return false;
  listenCancelled = true;
  voice.stopListening(true);
  $("voiceStatus").textContent = "Cancelled.";
  return true;
}
$("mic").onclick = startListening;
$("cancelVoice").onclick = cancelListening;
// Esc: cancel listening/transcribing, else stop Claude's reply, else stop the voice.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || currentTab !== "tutor") return;
  if (cancelListening()) return;
  if (busy) { abortCtl?.abort(); return; }
  voice.stopSpeaking();
});
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "m" && currentTab === "tutor") { e.preventDefault(); startListening(); }
});
function speakOpts() { return { jaRate: S.jaRate, onlyJapanese: S.readAloud === "ja" }; }

// Find the offline voice helper (or browser speech) and update the UI.
let setupPolls = 0; // keeps checking while the helper restarts after installing voice
async function refreshVoice() {
  $("voiceHelperStatus").textContent = "Checking…";
  const h = await voice.detect();
  const ok = voice.canListen();
  $("mic").disabled = !ok;
  $("mic").title = ok ? "Talk (Ctrl+M)" : "Voice input needs the free voice helper (see Settings)";
  if (setupPolls > 0 && (!h || !h.stt) && h?.setup?.state !== "failed") {
    setupPolls--;
    if (!h || h.setup?.state === "idle") { $("voiceHelperStatus").textContent = "Installing voice: restarting…"; setTimeout(refreshVoice, 2000); return; }
  }
  if (h?.stt) setupPolls = 0;
  $("voiceSetupRow").classList.toggle("hidden", !(h && !h.stt && h.setup?.state !== "running"));
  if (h?.setup?.state === "running" || h?.setup?.state === "restarting") {
    $("voiceHelperStatus").textContent = `Installing voice: ${h.setup.step}…`;
    setTimeout(refreshVoice, 2000);
    return;
  }
  if (h?.setup?.state === "failed") {
    $("voiceHelperStatus").textContent = h.setup.error;
    return;
  }
  if (h) {
    const parts = [h.stt ? "speech recognition ✓" : "speech recognition ✗", h.tts_ja ? "Japanese voice ✓" : "Japanese voice ✗", h.tts_en ? "English voice ✓" : "English voice: browser"];
    $("voiceHelperStatus").textContent = `Voice helper running: ${parts.join(" · ")}`;
    renderVoicevox(h.voicevox);
    for (const o of $("sttModel").options) o.textContent = o.textContent.replace(/ ✓ downloaded$/, "") + ((h.downloaded || []).includes(o.value) ? " ✓ downloaded" : "");
    watchSttModel();
  } else {
    $("voiceHelperStatus").textContent = voice.canListen()
      ? "Voice helper not running. Using this browser's built-in speech instead."
      : "Voice helper not running, so voice input is off. Install it with the command in the README, or start it with: systemctl --user start japanese-tutor-voice";
  }
}
refreshVoice();

function bindToggle(id, key) {
  const el = $(id);
  el.checked = !!S[key];
  el.onchange = () => { S[key] = el.checked; save(); if (key === "speakReplies" && !el.checked) voice.stopSpeaking(); };
}
bindToggle("speakReplies", "speakReplies");
bindToggle("handsFree", "handsFree");
$("micLang").value = S.micLang;
$("micLang").onchange = () => { S.micLang = $("micLang").value; save(); };

// Resume the most recent session if it's from today.
const last = db.sessions.at(-1);
if (last && today(last.started) === today()) { session = last; $("mode").value = last.mode; }
renderSession();
refreshKeyBanner();
refreshSpend();

/* ---------- kana ---------- */
let kanaCur = null, kanaChecked = false;
function kanaIds() {
  return GROUPS.filter((g) => S.studyGroups.includes(g.name)).flatMap((g) => g.cards.map(([k]) => "kana:" + k));
}
function nextKana() {
  const ids = kanaIds();
  kanaCur = pickNext(ids, kanaCur);
  kanaChecked = false;
  const k = kanaCur?.slice(5) || "";
  $("kanaFront").textContent = k;
  applyCardFont($("kanaFront"), $("kanaFontName"));
  $("kanaRomaji").innerHTML = "";
  $("kanaAnswer").value = "";
  $("kanaAnswer").disabled = false;
  $("kanaResult").textContent = "";
  $("kanaResult").className = "result";
  $("kanaNext").classList.add("hidden");
  $("kanaInfo").textContent = `${ids.length} kana · ${countDue(ids)} due for review · ${ids.filter((i) => !db.items[i]).length} new`;
  $("kanaAnswer").focus();
}
function checkKana() {
  if (!kanaCur) return;
  if (kanaChecked) { nextKana(); return; }
  const k = kanaCur.slice(5), r = KANA[k].romaji;
  const ans = $("kanaAnswer").value;
  if (!ans.trim()) return;
  const ok = romajiMatches(ans, r);
  grade(kanaCur, ok);
  kanaChecked = true;
  $("kanaRomaji").innerHTML = romajiHTML(r);
  $("kanaResult").textContent = ok ? "Correct" : `No, you typed “${ans.trim()}”`;
  $("kanaResult").className = "result " + (ok ? "ok" : "no");
  $("kanaNext").classList.remove("hidden");
}
$("kanaAnswer").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkKana(); } });
$("kanaNext").onclick = nextKana;

/* ---------- Trip Up: drill look-alike kana within the study set ---------- */
let trip = null;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function studySet() {
  return new Set(GROUPS.filter((g) => S.studyGroups.includes(g.name)).flatMap((g) => g.cards.map(([k]) => k)));
}
function showKanaMode() {
  const tripMode = S.kanaMode === "trip";
  $("kanaMode").value = S.kanaMode;
  $("tripCard").classList.toggle("hidden", !tripMode);
  $("typeCard").classList.toggle("hidden", tripMode);
  if (tripMode) { $("kanaInfo").textContent = ""; if (!trip) nextTrip(); }
  else { if (!kanaCur) nextKana(); setTimeout(() => $("kanaAnswer").focus(), 0); }
}
$("kanaMode").onchange = () => { S.kanaMode = $("kanaMode").value; save(); trip = null; showKanaMode(); };

function nextTrip() {
  const set = studySet();
  const ids = [...set].filter((k) => lookalikesIn(k, set).length).map((k) => "trip:" + k);
  $("tripResult").textContent = ""; $("tripResult").className = "result";
  $("tripNext").classList.add("hidden");
  if (!ids.length) {
    trip = null;
    $("tripPrompt").innerHTML = "None of your selected kana look much alike yet. Add more rows with “Choose kana…” (T, N, H, M, R and W have lots of look-alikes) to unlock Trip Up.";
    $("tripChoices").innerHTML = ""; $("tripInfo").textContent = ""; $("tripFontName").textContent = "";
    return;
  }
  // Skip the previous question's whole look-alike group so pairs don't come back to back.
  const id = pickNext(ids, trip ? trip.choices.map((k) => "trip:" + k) : []);
  const target = id.slice(5);
  // Shuffle answer positions, and never reuse the previous question's order.
  let choices;
  for (let n = 0; n < 6; n++) {
    choices = shuffle([target, ...shuffle(lookalikesIn(target, set)).slice(0, 3)]);
    if (!trip || choices.join("") !== trip.choices.join("") || choices.length < 2) break;
  }
  // Mix the question direction, but not the same direction three times running.
  let ask = Math.random() < 0.5 ? "kana" : "romaji";
  if (trip && trip.ask === ask && trip.prevAsk === ask) ask = ask === "kana" ? "romaji" : "kana";
  trip = { target, choices, ask, prevAsk: trip?.ask, answered: false };
  // Variable font mode: one random style for the whole question.
  const card = $("tripCard");
  if (S.fontMode === "variable") {
    const i = randomFontIndex();
    card.style.setProperty("--kana", `${FONTS[i].family}, var(--jp)`);
    card.style.setProperty("--kana-weight", i === 0 ? "600" : "400");
    $("tripFontName").textContent = FONTS[i].name;
  } else {
    card.style.removeProperty("--kana"); card.style.removeProperty("--kana-weight");
    $("tripFontName").textContent = "";
  }
  const r = KANA[target].romaji;
  $("tripPrompt").innerHTML = trip.ask === "kana"
    ? `Which one is<span class="big romaji">${romajiHTML(r)}</span>`
    : `What is this?<span class="big kana">${target}</span>`;
  $("tripChoices").innerHTML = choices.map((k, n) => `<button class="choice" data-k="${k}">${
    trip.ask === "kana" ? `<span class="k">${k}</span>` : `<span class="rm">${romajiHTML(KANA[k].romaji)}</span>`
  }<span class="after"></span><span class="n">${n + 1}</span></button>`).join("");
  $("tripInfo").textContent = `${ids.length} of your ${set.size} kana have a look-alike in your set · ${countDue(ids)} due`;
}
function answerTrip(k) {
  if (!trip || trip.answered) return;
  trip.answered = true;
  const ok = k === trip.target;
  grade("trip:" + trip.target, ok);
  if (!ok) {
    const pair = [trip.target, k].sort().join("|");
    db.confusions[pair] = (db.confusions[pair] || 0) + 1;
    save();
  }
  for (const b of $("tripChoices").children) {
    const bk = b.dataset.k;
    b.classList.toggle("right", bk === trip.target);
    b.classList.toggle("wrong", bk === k && !ok);
    // Reveal the other half of every option so the difference sinks in.
    b.querySelector(".after").innerHTML = trip.ask === "kana" ? romajiHTML(KANA[bk].romaji) : `<span class="jp">${bk}</span>`;
  }
  const t = trip.target;
  $("tripResult").innerHTML = ok ? "Correct" : `No. That's <span class="jp">${k}</span> (${KANA[k].romaji}). You wanted <span class="jp">${t}</span> (${KANA[t].romaji}).`;
  $("tripResult").className = "result " + (ok ? "ok" : "no");
  $("tripNext").classList.remove("hidden");
}
$("tripChoices").addEventListener("click", (e) => { const b = e.target.closest(".choice"); if (b) answerTrip(b.dataset.k); });
$("tripNext").onclick = nextTrip;
document.addEventListener("keydown", (e) => {
  if (currentTab !== "kana" || S.kanaMode !== "trip" || e.target.matches("input, textarea, select")) return;
  if (/^[1-4]$/.test(e.key) && trip && !trip.answered) { const k = trip.choices[+e.key - 1]; if (k) answerTrip(k); }
  else if (e.key === "Enter" && trip?.answered) { e.preventDefault(); nextTrip(); }
});
$("kanaSay").onclick = () => kanaCur && voice.speak(kanaCur.slice(5), { jaRate: S.jaRate });

function renderPicker() {
  const p = $("groupPicker");
  p.innerHTML = "";
  for (const g of GROUPS) {
    const c = document.createElement("span");
    c.className = "chip" + (S.studyGroups.includes(g.name) ? " on" : "");
    c.innerHTML = `${esc(g.name)} <span class="jp">${g.cards.map((x) => x[0]).join("")}</span>`;
    c.onclick = () => {
      const on = S.studyGroups.includes(g.name);
      if (on && S.studyGroups.length === 1) return;
      S.studyGroups = on ? S.studyGroups.filter((n) => n !== g.name) : [...S.studyGroups, g.name];
      save(); renderPicker(); vCur = null; kanaCur = null; trip = null; showKanaMode();
      if (!$("kanaChart").classList.contains("hidden")) $("kanaChart").innerHTML = chartHTML(S.studyGroups, false);
    };
    p.appendChild(c);
  }
}
$("pickGroups").onclick = () => { $("groupPicker").classList.toggle("hidden"); renderPicker(); };
$("showChart").onclick = () => {
  const c = $("kanaChart");
  c.classList.toggle("hidden");
  c.innerHTML = chartHTML(S.studyGroups, false);
  $("showChart").textContent = c.classList.contains("hidden") ? "Chart" : "Hide chart";
};

/* ---------- vocab ---------- */
let vCur = null, vRevealed = false;
const topics = ["All topics", ...[...new Set(VOCAB.map((w) => w.topic))].sort()];
for (const t of topics) $("topic").add(new Option(t, t));
function vocabPool() {
  if ($("deck").value === "tutor") return db.tutorWords.map((w) => ({ ...w, romaji: "", id: "word:" + w.kana }));
  const t = $("topic").value;
  return VOCAB.filter((w) => readable(w, S.studyGroups) && (t === "All topics" || w.topic === t)).map((w) => ({ ...w, id: "word:" + w.kana }));
}
function nextVocab() {
  const pool = vocabPool();
  $("topic").classList.toggle("hidden", $("deck").value === "tutor");
  const ids = pool.map((w) => w.id);
  $("vocabInfo").textContent = `${ids.length} words · ${countDue(ids)} due`;
  vRevealed = false;
  $("vBack").classList.add("hidden");
  $("vReveal").classList.remove("hidden");
  $("vMiss").classList.add("hidden"); $("vKnew").classList.add("hidden");
  if (!ids.length) {
    vCur = null;
    $("vFront").className = "word en";
    $("vFront").style.fontFamily = ""; $("vFontName").textContent = "";
    $("vFront").textContent = $("deck").value === "tutor" ? "No tutor words yet. They appear here as the tutor teaches you." : "No words use only the kana you've picked yet. Add more kana groups in the Kana tab.";
    $("vReveal").classList.add("hidden");
    return;
  }
  const id = pickNext(ids, vCur?.id);
  vCur = pool.find((w) => w.id === id);
  const jp = $("direction").value === "jp";
  $("vFront").className = jp ? "word" : "word en";
  $("vFront").textContent = jp ? vCur.kana : vCur.en;
  if (jp) applyCardFont($("vFront"), $("vFontName"));
  else { $("vFront").style.fontFamily = ""; $("vFontName").textContent = ""; }
}
function revealVocab() {
  if (!vCur || vRevealed) return;
  vRevealed = true;
  const jp = $("direction").value === "jp";
  const extra = [vCur.kanji && `<div class="jp">${esc(vCur.kanji)}</div>`, vCur.romaji && `<div class="romaji">${esc(vCur.romaji)}</div>`].filter(Boolean).join("");
  $("vBack").innerHTML = jp ? `<div>${esc(vCur.en)}</div>${extra}` : `<div class="jp">${esc(vCur.kana)}</div>${extra}`;
  $("vBack").classList.remove("hidden");
  $("vReveal").classList.add("hidden");
  $("vMiss").classList.remove("hidden"); $("vKnew").classList.remove("hidden");
  if (!jp) voice.speak(vCur.kana, { jaRate: S.jaRate });
}
function answerVocab(ok) { if (!vCur || !vRevealed) return; grade(vCur.id, ok); nextVocab(); }
$("vReveal").onclick = revealVocab;
$("vKnew").onclick = () => answerVocab(true);
$("vMiss").onclick = () => answerVocab(false);
$("vSay").onclick = () => vCur && voice.speak(vCur.kana, { jaRate: S.jaRate });
["deck", "direction", "topic"].forEach((id) => ($(id).onchange = () => { vCur = null; nextVocab(); }));
document.addEventListener("keydown", (e) => {
  if (currentTab !== "vocab" || e.target.matches("input, textarea, select")) return;
  if (e.key === " ") { e.preventDefault(); revealVocab(); }
  else if (e.key === "ArrowRight" || e.key === "1") answerVocab(true);
  else if (e.key === "ArrowLeft" || e.key === "2") answerVocab(false);
});

/* ---------- dictionary ---------- */
function renderDict() {
  const q = $("dictSearch").value.trim().toLowerCase();
  const norm = (x) => x.toLowerCase().replace(/[\s'-]/g, "");
  const onlyReadable = $("dictReadable").checked;
  const rows = VOCAB.filter((w) => {
    if (onlyReadable && !readable(w, S.studyGroups)) return false;
    if (!q) return true;
    return w.kana.includes(q) || (w.kanji && w.kanji.includes(q)) || norm(w.romaji).includes(norm(q)) || w.en.toLowerCase().includes(q);
  });
  const can = VOCAB.filter((w) => readable(w, S.studyGroups)).length;
  $("dictStatus").textContent = `${rows.length} words shown · you can read ${can} of ${VOCAB.length} with the kana you've picked`;
  $("dictList").innerHTML = rows.slice(0, 400).map((w) =>
    `<div class="drow${readable(w, S.studyGroups) ? "" : " locked"}"><span class="jp">${esc(w.kana)}</span><span class="romaji">${esc(w.romaji)}</span><span class="en">${esc(w.en)}${w.kanji ? ` <span class="jp meta">${esc(w.kanji)}</span>` : ""}</span><span class="meta">${esc(w.topic)}</span><button data-say="${esc(w.kana)}" title="Hear it">🔊</button></div>`
  ).join("");
}
$("dictSearch").addEventListener("input", renderDict);
$("dictReadable").onchange = renderDict;
$("dictList").addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) voice.speak(b.dataset.say, speakOpts()); });

/* ---------- progress ---------- */
function renderProgress() {
  const kanaAll = GROUPS.flatMap((g) => g.cards.map(([k]) => k));
  const solid = kanaAll.filter((k) => (db.items["kana:" + k]?.box || 0) >= MASTERED_BOX).length;
  const words = Object.entries(db.items).filter(([id, it]) => id.startsWith("word:") && it.box >= MASTERED_BOX).length;
  const todayMin = Math.round((db.days[today()]?.sec || 0) / 60);
  const stat = (b, s) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`;
  $("stats").innerHTML = [
    stat(`${streak()}`, "day streak"),
    stat(`${todayMin} / ${S.dailyGoalMin}`, "minutes today (in this app)"),
    stat(`${solid} / ${kanaAll.length}`, "hiragana solid"),
    stat(`${words}`, "words solid"),
    stat(`${db.mistakes.length}`, "mistakes logged"),
    stat(`$${costSoFar().toFixed(2)}`, "estimated API spend"),
  ].join("");
  const days = [];
  const max = Math.max(S.dailyGoalMin, ...Array.from({ length: 14 }, (_, i) => (db.days[today(Date.now() - i * 864e5)]?.sec || 0) / 60));
  for (let i = 13; i >= 0; i--) {
    const t = Date.now() - i * 864e5, m = (db.days[today(t)]?.sec || 0) / 60;
    days.push(`<div class="day${m >= S.dailyGoalMin ? " goal" : ""}" title="${Math.round(m)} min"><i style="height:${(m / max) * 100}%"></i>${new Date(t).getDate()}</div>`);
  }
  $("days").innerHTML = days.join("");
  $("kanaGrid").innerHTML = chartHTML(GROUPS.map((g) => g.name), true);
  const conf = Object.entries(db.confusions || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("confusions").innerHTML = conf.map(([pair, n]) => {
    const [a, b] = pair.split("|");
    return `<div class="m"><span class="jp">${a}</span> <i class="romaji small">${KANA[a]?.romaji || ""}</i> ⇄ <span class="jp">${b}</span> <i class="romaji small">${KANA[b]?.romaji || ""}</i> <span class="muted small">· mixed up ${n}×</span></div>`;
  }).join("") || '<p class="muted">None yet. Try Trip Up in the Kana tab.</p>';
  $("mistakes").innerHTML = db.mistakes.slice(-25).reverse().map((m) =>
    `<div class="m"><span class="jp">${esc(m.said)}</span> → <span class="c jp">${esc(m.correction)}</span><div class="muted small">${esc(m.category)} · ${esc(m.explanation)} · ${new Date(m.at).toLocaleDateString()}</div></div>`
  ).join("") || '<p class="muted">None yet. The tutor logs mistakes as you talk to it.</p>';
  $("notes").textContent = db.notes || "None yet. The tutor writes these as it gets to know your level.";
}
$("exportBtn").onclick = () => {
  const blob = new Blob([exportJSON()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `japanese-progress-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("importFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    importJSON(await f.text());
    location.reload();
  } catch (err) { alert("Import failed: " + err.message); }
};

/* ---------- settings ---------- */
for (const m of MODELS) $("model").add(new Option(m.name, m.id));
$("model").value = S.model;
$("effort").value = S.effort;
$("apiKey").value = S.apiKey;
$("showRomaji").checked = S.showRomaji;
$("jaRate").value = S.jaRate; $("jaRateVal").textContent = S.jaRate + "×";
$("dailyGoal").value = S.dailyGoalMin;
$("ver").textContent = VERSION;
$("apiKey").oninput = () => { S.apiKey = $("apiKey").value.trim(); save(); refreshKeyBanner(); };
$("showKey").onclick = () => { const k = $("apiKey"); k.type = k.type === "password" ? "text" : "password"; $("showKey").textContent = k.type === "password" ? "Show" : "Hide"; };
$("model").onchange = () => { S.model = $("model").value; save(); };
$("effort").onchange = () => { S.effort = $("effort").value; save(); };
$("showRomaji").onchange = () => { S.showRomaji = $("showRomaji").checked; save(); };
document.querySelectorAll('input[name="fontMode"]').forEach((r) => {
  r.checked = r.value === S.fontMode;
  r.onchange = () => { S.fontMode = r.value; save(); kanaCur = null; vCur = null; trip = null; };
});
$("fontSamples").innerHTML = FONTS.map((f) => `<span><b style="font-family:${f.family.replace(/"/g, "'")}">あきさ</b>${esc(f.name.split(" (")[0])}</span>`).join("");
$("jaRate").oninput = () => { S.jaRate = +$("jaRate").value; $("jaRateVal").textContent = S.jaRate + "×"; save(); };
$("dailyGoal").onchange = () => { S.dailyGoalMin = Math.max(5, +$("dailyGoal").value || 30); save(); };
$("checkVoice").onclick = refreshVoice;
$("voiceSetup").onclick = async () => {
  $("voiceSetupRow").classList.add("hidden");
  setupPolls = 600;
  try { await voice.startSetup(S.sttModel); } catch {}
  setTimeout(refreshVoice, 500);
};
$("sttModel").value = S.sttModel;
/* Japanese voice: VOICEVOX (natural) or Open JTalk (basic) */
let vvPoll = null;
function applyJaVoice(vv) {
  const natural = !!vv?.installed && S.jaEngine === "voicevox";
  voice.jaVoice.engine = natural ? "voicevox" : "basic";
  voice.jaVoice.voice = S.jaVoice;
}
function renderVoicevox(vv) {
  clearTimeout(vvPoll);
  const sel = $("jaVoice");
  const opts = [];
  if (vv?.installed) for (const v of vv.voices) opts.push([String(v.id), `${v.name}${v.style && v.style !== "ノーマル" ? " (" + v.style + ")" : ""}`]);
  opts.push(["basic", "Basic (Open JTalk, robotic)"]);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
  sel.value = vv?.installed && S.jaEngine === "voicevox" ? String(S.jaVoice) : "basic";
  if (!sel.value) sel.value = opts[0][0];
  applyJaVoice(vv);
  const st = vv?.status || {};
  const running = st.state === "running";
  $("vvPanel").classList.toggle("hidden", !vv || (vv.installed && !running));
  $("vvInstall").classList.toggle("hidden", running);
  $("vvCancel").classList.toggle("hidden", !running);
  $("vvBar").classList.toggle("hidden", !running);
  if (running) {
    $("vvBar").max = st.total_mb || 1; $("vvBar").value = st.mb || 0;
    const eta = st.eta_s != null ? ` · about ${voice.fmtTime(st.eta_s)} left` : "";
    $("vvDetail").textContent = `${st.step}… ${st.mb} of ${st.total_mb} MB${st.mbps ? ` · ${st.mbps} MB/s` : ""}${eta}`;
    vvPoll = setTimeout(refreshVoice, 1000);
  } else if (st.state === "failed") {
    $("vvDetail").textContent = st.error;
    $("vvInstall").textContent = "Try again";
  }
}
$("vvInstall").onclick = async () => {
  try { await voice.installVoicevox(); } catch {}
  S.jaEngine = "voicevox"; save();
  setTimeout(refreshVoice, 400);
};
$("vvCancel").onclick = async () => { await voice.cancelVoicevox(); setTimeout(refreshVoice, 600); };
$("jaVoice").onchange = () => {
  const v = $("jaVoice").value;
  if (v === "basic") S.jaEngine = "basic"; else { S.jaEngine = "voicevox"; S.jaVoice = +v; }
  save(); applyJaVoice(voice.status.helper?.voicevox);
  voice.speak("こんにちは。きょうは いい てんき ですね。", { jaRate: S.jaRate });
};
function applyTextSize() { document.body.dataset.text = S.textSize; document.body.dataset.jp = S.jpSize || "1.9"; }
applyTextSize();
$("textSize").value = S.textSize;
$("textSize").onchange = () => { S.textSize = $("textSize").value; save(); applyTextSize(); };
$("jpSize").value = S.jpSize || "1.9";
$("jpSize").onchange = () => { S.jpSize = $("jpSize").value; save(); applyTextSize(); };

let sttPoll = null;
async function watchSttModel() {
  clearTimeout(sttPoll);
  const m = await voice.modelStatus();
  const panel = $("sttPanel");
  const busy = m && (m.phase === "downloading" || m.phase === "loading");
  if (!m || (!busy && !m.error && m.size !== S.sttModel)) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  const bar = $("sttBar");
  $("sttCancel").classList.toggle("hidden", m.phase !== "downloading");
  $("sttRetry").classList.toggle("hidden", busy || !m.error);
  if (m.phase === "downloading") {
    $("sttTitle").textContent = `Downloading the ${m.size} speech model (one time only)`;
    bar.classList.remove("hidden");
    bar.max = m.total_mb || 1; bar.value = m.mb || 0;
    const pct = m.total_mb ? Math.floor((100 * m.mb) / m.total_mb) : 0;
    const speed = m.mbps ? `${m.mbps} MB/s` : "starting…";
    const eta = m.eta_s != null ? ` · about ${voice.fmtTime(m.eta_s)} left` : "";
    $("sttDetail").innerHTML = `${voice.fmtMB(m.mb)} of ${voice.fmtMB(m.total_mb)} (${pct}%) · ${speed}${eta} · running ${voice.fmtTime(m.elapsed_s)}<br>` +
      `File: ${esc(m.file || "")}<br>Saving to <span class="path">${esc(m.dest || "")}</span><br>` +
      `Voice input keeps working with a model you already have until this finishes.`;
  } else if (m.phase === "loading") {
    $("sttTitle").textContent = `Loading the ${m.size} speech model into memory`;
    bar.classList.remove("hidden"); bar.removeAttribute("value");
    $("sttDetail").textContent = `${m.elapsed_s} s so far. This usually takes 5 to 30 seconds, longer on slow computers.`;
  } else if (m.error) {
    $("sttTitle").textContent = "Speech model problem";
    bar.classList.add("hidden");
    $("sttDetail").textContent = m.error;
  } else {
    $("sttTitle").textContent = `The ${m.size} speech model is loaded and ready.`;
    bar.classList.add("hidden");
    $("sttDetail").textContent = "";
  }
  if (busy) sttPoll = setTimeout(watchSttModel, 1000);
}
$("sttCancel").onclick = async () => { await voice.cancelModelDownload(); setTimeout(watchSttModel, 500); };
$("sttRetry").onclick = async () => { await voice.preloadModel(S.sttModel); setTimeout(watchSttModel, 300); };
$("sttModel").onchange = async () => {
  S.sttModel = $("sttModel").value; save();
  if (!voice.status.helper?.stt) return;
  await voice.preloadModel(S.sttModel);
  setTimeout(watchSttModel, 300);
};
document.querySelector('[data-tab="settings"]').addEventListener("click", () => watchSttModel());
$("readAloud").value = S.readAloud;
$("readAloud").onchange = () => { S.readAloud = $("readAloud").value; save(); };
$("testVoice").onclick = () => {
  $("voiceCheck").textContent = voice.hasJapaneseVoice() ? "" : "No Japanese voice found. Install the voice helper (see the README).";
  voice.speak("こんにちは。にほんごの れんしゅうを しましょう。", { jaRate: S.jaRate });
};

/* ---------- lessons ---------- */
var lessons = mountLessons($("lessons"), {
  say: (t) => voice.speak(t, { jaRate: S.jaRate }),
  onKanaAdded: () => { kanaCur = null; vCur = null; trip = null; },
});

window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
