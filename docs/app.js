import { db, save, saveNow, today, activity, streak, grade, pickNext, countDue, exportJSON, importJSON, MASTERED_BOX } from "./store.js";
import { GROUPS, KANA, VOCAB, readable, romajiMatches } from "./kana.js";
import { MODELS, MODES, newSession, send, costSoFar } from "./tutor.js";
import * as voice from "./voice.js";

const VERSION = "2";
const $ = (id) => document.getElementById(id);
const S = db.settings;

/* ---------- tabs ---------- */
let currentTab = "tutor";
function showTab(name) {
  currentTab = name;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === name));
  if (name === "progress") renderProgress();
  if (name === "kana") { if (!kanaCur) nextKana(); setTimeout(() => $("kanaAnswer").focus(), 0); }
  if (name === "vocab" && !vCur) nextVocab();
  if (name === "tutor") refreshKeyBanner();
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
function applyCardFont(el, labelEl) {
  if (S.fontMode !== "variable") { el.style.fontFamily = ""; el.style.fontWeight = ""; labelEl.textContent = ""; return; }
  let i;
  do { i = Math.floor(Math.random() * FONTS.length); } while (i === lastFont && FONTS.length > 1);
  lastFont = i;
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
  if (b) voice.speak(b.parentElement.dataset.text, { jaRate: S.jaRate });
});

function renderSession() {
  log.innerHTML = "";
  if (!session) { addMsg("note", "Pick a session type above and press New session, or just start talking."); return; }
  addMsg("note", `${MODES[session.mode]?.label || "Session"} · ${new Date(session.started).toLocaleString()}`);
  // One bubble per reply, even when a reply spanned several tool-use rounds.
  let reply = "";
  const flush = () => { if (reply.trim()) addMsg("them", reply, { speakable: voice.canSpeak }); reply = ""; };
  for (const m of session.messages) {
    if (m.role === "user" && typeof m.content === "string") {
      flush();
      if (!m.content.startsWith("(Session start)")) addMsg("me", m.content.replace(/^\[spoken\] /, "🎤 "));
    } else if (m.role === "assistant") {
      const t = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
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
    setMsg(bubble, reply || "_(no reply)_", voice.canSpeak);
    activity("msg");
    setBusy(false);
    if (S.speakReplies && reply) {
      $("voiceStatus").textContent = "Speaking…";
      await voice.speak(reply, { jaRate: S.jaRate });
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
let listening = false;
async function startListening() {
  if (busy) return;
  if (listening) { voice.stopListening(); return; }
  listening = true;
  $("mic").classList.add("listening");
  $("voiceStatus").textContent = S.micLang === "ja-JP" ? "Listening (日本語)…" : "Listening (English)…";
  try {
    const text = await voice.listen(S.micLang, (t) => { $("input").value = t; autoGrow(); });
    $("input").value = ""; autoGrow();
    $("voiceStatus").textContent = "";
    if (text) talk(text, { spoken: true });
    else $("voiceStatus").textContent = "Didn't catch anything.";
  } catch (e) {
    $("voiceStatus").textContent = "";
    addMsg("err", e.message);
  } finally {
    listening = false;
    $("mic").classList.remove("listening");
  }
}
$("mic").onclick = startListening;
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "m" && currentTab === "tutor") { e.preventDefault(); startListening(); }
});
if (!voice.canListen) {
  $("mic").disabled = true;
  $("mic").title = "Speech recognition needs Google Chrome";
}

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
  if (ok) setTimeout(() => { if (kanaChecked && $("kanaFront").textContent === k) nextKana(); }, 700);
}
$("kanaAnswer").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkKana(); } });
$("kanaNext").onclick = nextKana;
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
      save(); renderPicker(); nextKana(); vCur = null;
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
  r.onchange = () => { S.fontMode = r.value; save(); kanaCur = null; vCur = null; };
});
$("fontSamples").innerHTML = FONTS.map((f) => `<span><b style="font-family:${f.family.replace(/"/g, "'")}">あきさ</b>${esc(f.name.split(" (")[0])}</span>`).join("");
$("jaRate").oninput = () => { S.jaRate = +$("jaRate").value; $("jaRateVal").textContent = S.jaRate + "×"; save(); };
$("dailyGoal").onchange = () => { S.dailyGoalMin = Math.max(5, +$("dailyGoal").value || 30); save(); };
$("testVoice").onclick = () => {
  $("voiceCheck").textContent = voice.hasJapaneseVoice() ? "" : "No Japanese voice found. Google Chrome includes one.";
  voice.speak("こんにちは。にほんごの れんしゅうを しましょう。", { jaRate: S.jaRate });
};

window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
