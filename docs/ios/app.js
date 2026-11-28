// iPhone version: kana, vocab, dictionary and progress. No tutor, no voice helper.
// Shares the word list, scheduling and progress format with the Linux app
// (../store.js, ../kana.js, ../data.js), so exported progress moves between them.
import { db, save, saveNow, today, streak, grade, pickNext, countDue, exportJSON, importJSON, MASTERED_BOX } from "../store.js";
import { GROUPS, KATA_GROUPS, scriptOf, studyCards, KANA, VOCAB, canRead, romajiMatches, lookalikesIn } from "../kana.js";
import { initKanji, kanjiGridHTML, kanjiSolid } from "../kanji-ui.js";
import { mountLessons } from "../lessons-ui.js";

const VERSION = "ios-3";
const $ = (id) => document.getElementById(id);
const S = db.settings;
S.autoSay ??= false;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- speech: the iPhone's own Japanese voice, offline ---------- */
const tts = "speechSynthesis" in window;
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
if (tts) { loadVoices(); speechSynthesis.addEventListener?.("voiceschanged", loadVoices); }
function jaVoice() {
  const ja = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ja"));
  // Prefer enhanced/premium downloads, then the usual iOS voices.
  const rank = (v) => (/premium/i.test(v.name + v.voiceURI) ? 0 : /enhanced/i.test(v.name + v.voiceURI) ? 1 : /kyoko|otoya|hattori|o-ren/i.test(v.name) ? 2 : 3);
  return ja.sort((a, b) => rank(a) - rank(b))[0] || null;
}
function say(text) {
  if (!tts || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  const v = jaVoice();
  if (v) u.voice = v;
  u.rate = S.jaRate || 0.85;
  speechSynthesis.speak(u);
}

/* ---------- tabs ---------- */
let currentTab = "kana";
function showTab(name) {
  currentTab = name;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === name));
  window.scrollTo(0, 0);
  if (name === "progress") renderProgress();
  if (name === "kana") showKanaMode(false);
  if (name === "vocab" && !vCur) nextVocab();
  if (name === "dict") renderDict();
  if (name === "lessons") lessons?.show();
  if (name === "kanji") kj.show();
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });

/* ---------- kana fonts ---------- */
const FONTS = [
  { name: "Textbook", family: '"Klee One"' },
  { name: "Mincho (books and signs)", family: '"Noto Serif JP"' },
  { name: "Gothic (screens and menus)", family: '"Noto Sans JP"' },
  { name: "Rounded", family: '"Kosugi Maru"' },
  { name: "Handwritten", family: '"Yomogi"' },
  { name: "Brush pen", family: '"Zen Kurenaido"' },
  { name: "Pixel (game text)", family: '"DotGothic16"' },
];
let lastFont = 0;
function randomFontIndex() {
  let i;
  do { i = Math.floor(Math.random() * FONTS.length); } while (i === lastFont);
  return (lastFont = i);
}
function applyCardFont(el, labelEl) {
  if (S.fontMode !== "variable") { el.style.fontFamily = ""; el.style.fontWeight = ""; labelEl.textContent = ""; return; }
  const i = randomFontIndex();
  el.style.fontFamily = `${FONTS[i].family}, var(--jp)`;
  el.style.fontWeight = i === 0 ? "" : "400";
  labelEl.textContent = FONTS[i].name;
}

/* ---------- hiragana chart ---------- */
const IRREGULAR = new Set(["shi", "chi", "tsu"]);
const romajiHTML = (r) => (IRREGULAR.has(r) ? `<sup>*</sup>${r}` : esc(r));
const COLS = { a: 0, i: 1, u: 2, e: 3, o: 4 };
function chartHTML(groupNames, withMastery, groups = GROUPS) {
  const cell = (k, r) => {
    const it = withMastery && db.items["kana:" + k];
    const cls = !it ? "" : it.box >= MASTERED_BOX ? "b4" : it.box >= 2 ? "b2" : "b1";
    return `<div class="cell ${cls}"><span class="k">${k}</span><span class="r">${romajiHTML(r)}</span></div>`;
  };
  const blank = '<div class="cell"></div>';
  const basic = [], combo = [];
  for (const g of groups.filter((x) => groupNames.includes(x.name))) {
    if (g.name.startsWith("Combos") || g.name.startsWith("Extended")) { for (const [k, r] of g.cards) combo.push(cell(k, r)); continue; }
    if (g.cards.length === 5) { basic.push(...g.cards.map(([k, r]) => cell(k, r))); continue; }
    const row = [blank, blank, blank, blank, blank], extra = [];
    for (const [k, r] of g.cards) { if (r === "n") extra.push(cell(k, r)); else row[COLS[r.at(-1)]] = cell(k, r); }
    basic.push(...row);
    if (extra.length) basic.push(...extra, blank, blank, blank, blank);
  }
  return (basic.length ? `<div class="chart">${basic.join("")}</div>` : "")
    + (combo.length ? `<div class="chart-title">Combinations</div><div class="chart combo">${combo.join("")}</div>` : "");
}

/* ---------- kana: type the romaji ---------- */
let kanaCur = null, kanaChecked = false;
const kanaIds = () => studyCards(S).map(([k]) => "kana:" + k);
function kanaInfo(ids) { $("kanaInfo").textContent = `${ids.length} kana · ${countDue(ids)} due · ${ids.filter((i) => !db.items[i]).length} new`; }
function nextKana(focus = true) {
  const ids = kanaIds();
  kanaCur = pickNext(ids, kanaCur);
  kanaChecked = false;
  $("kanaFront").textContent = kanaCur?.slice(5) || "";
  applyCardFont($("kanaFront"), $("kanaFontName"));
  $("kanaRomaji").innerHTML = "";
  $("kanaAnswer").value = "";
  $("kanaResult").textContent = ""; $("kanaResult").className = "result";
  $("kanaGo").textContent = "Check";
  kanaInfo(ids);
  // iOS only opens the keyboard when focus happens during a tap.
  if (focus) $("kanaAnswer").focus();
}
$("kanaForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!kanaCur) return;
  if (kanaChecked) { nextKana(); return; }
  const ans = $("kanaAnswer").value;
  if (!ans.trim()) { $("kanaAnswer").focus(); return; }
  const k = kanaCur.slice(5), r = KANA[k].romaji, ok = romajiMatches(ans, r);
  grade(kanaCur, ok);
  kanaChecked = true;
  $("kanaRomaji").innerHTML = romajiHTML(r);
  $("kanaResult").textContent = ok ? "Correct" : `No, you typed “${ans.trim()}”`;
  $("kanaResult").className = "result " + (ok ? "ok" : "no");
  $("kanaGo").textContent = "Next";
  $("kanaAnswer").value = "";
  $("kanaAnswer").placeholder = "Go for next";
  kanaInfo(kanaIds());
  if (S.autoSay) say(k);
  $("kanaAnswer").focus(); // keep the keyboard up so Go moves on
});
$("kanaAnswer").addEventListener("input", () => { $("kanaAnswer").placeholder = "romaji"; });
$("kanaSay").onclick = () => kanaCur && say(kanaCur.slice(5));

/* ---------- kana: Trip Up (look-alikes) ---------- */
let trip = null;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const studySet = () => new Set(studyCards(S).map(([k]) => k));
function showKanaMode(focus) {
  const tripMode = S.kanaMode === "trip";
  $("kanaMode").value = S.kanaMode;
  $("kanaScript").value = S.kanaScript;
  $("tripCard").classList.toggle("hidden", !tripMode);
  $("typeCard").classList.toggle("hidden", tripMode);
  $("kanaInfo").classList.toggle("hidden", tripMode);
  if (tripMode) { if (!trip) nextTrip(); }
  else if (!kanaCur) nextKana(focus);
}
$("kanaMode").onchange = () => { S.kanaMode = $("kanaMode").value; save(); trip = null; showKanaMode(false); };
$("kanaScript").onchange = () => {
  S.kanaScript = $("kanaScript").value; save();
  kanaCur = null; trip = null; showKanaMode(false);
  if (!$("groupPicker").classList.contains("hidden")) renderPicker();
  refreshChart();
};
const selectedRows = () => S[scriptOf(S).setting];
function refreshChart() {
  if (!$("kanaChart").classList.contains("hidden")) $("kanaChart").innerHTML = chartHTML(selectedRows(), false, scriptOf(S).groups);
}

function nextTrip() {
  const set = studySet();
  const ids = [...set].filter((k) => lookalikesIn(k, set).length).map((k) => "trip:" + k);
  $("tripResult").textContent = ""; $("tripResult").className = "result";
  $("tripNext").classList.add("hidden");
  if (!ids.length) {
    trip = null;
    $("tripPrompt").innerHTML = "None of your kana look much alike yet. Tap “Kana…” and add more rows (T, N, H, M, R and W have lots of look-alikes) to unlock Trip Up.";
    $("tripChoices").innerHTML = ""; $("tripInfo").textContent = ""; $("tripFontName").textContent = "";
    return;
  }
  const id = pickNext(ids, trip ? trip.choices.map((k) => "trip:" + k) : []);
  const target = id.slice(5);
  let choices;
  for (let n = 0; n < 6; n++) {
    choices = shuffle([target, ...shuffle(lookalikesIn(target, set)).slice(0, 3)]);
    if (!trip || choices.join("") !== trip.choices.join("")) break;
  }
  let ask = Math.random() < 0.5 ? "kana" : "romaji";
  if (trip && trip.ask === ask && trip.prevAsk === ask) ask = ask === "kana" ? "romaji" : "kana";
  trip = { target, choices, ask, prevAsk: trip?.ask, answered: false };
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
  $("tripPrompt").innerHTML = ask === "kana"
    ? `Which one is<span class="big romaji">${romajiHTML(KANA[target].romaji)}</span>`
    : `What is this?<span class="big kana">${target}</span>`;
  $("tripChoices").innerHTML = choices.map((k) => `<button class="choice" data-k="${k}">${
    ask === "kana" ? `<span class="k">${k}</span>` : `<span class="rm">${romajiHTML(KANA[k].romaji)}</span>`
  }<span class="after"></span></button>`).join("");
  $("tripInfo").textContent = `${ids.length} of your ${set.size} kana have a look-alike in your set · ${countDue(ids)} due`;
}
function answerTrip(k) {
  if (!trip || trip.answered) return;
  trip.answered = true;
  const ok = k === trip.target, t = trip.target;
  grade("trip:" + t, ok);
  if (!ok) { const pair = [t, k].sort().join("|"); db.confusions[pair] = (db.confusions[pair] || 0) + 1; save(); }
  for (const b of $("tripChoices").children) {
    const bk = b.dataset.k;
    b.classList.toggle("right", bk === t);
    b.classList.toggle("wrong", bk === k && !ok);
    b.querySelector(".after").innerHTML = trip.ask === "kana" ? romajiHTML(KANA[bk].romaji) : `<span class="jp">${bk}</span>`;
  }
  $("tripResult").innerHTML = ok ? "Correct" : `No. That's <span class="jp">${k}</span> (${KANA[k].romaji}). You wanted <span class="jp">${t}</span> (${KANA[t].romaji}).`;
  $("tripResult").className = "result " + (ok ? "ok" : "no");
  $("tripNext").classList.remove("hidden");
  if (S.autoSay) say(t);
}
$("tripChoices").addEventListener("click", (e) => { const b = e.target.closest(".choice"); if (b) answerTrip(b.dataset.k); });
$("tripNext").onclick = nextTrip;

/* ---------- choosing kana rows ---------- */
function renderPicker() {
  const p = $("groupPicker");
  p.innerHTML = "";
  const sc = scriptOf(S), key = sc.setting;
  for (const g of sc.groups) {
    const c = document.createElement("button");
    c.className = "chip" + (S[key].includes(g.name) ? " on" : "");
    c.innerHTML = `${esc(g.name)} <span class="jp">${g.cards.map((x) => x[0]).join("")}</span>`;
    c.onclick = () => {
      const on = S[key].includes(g.name);
      if (on && S[key].length === 1) return;
      S[key] = on ? S[key].filter((n) => n !== g.name) : [...S[key], g.name];
      save(); renderPicker(); vCur = null; kanaCur = null; trip = null; showKanaMode(false);
      refreshChart();
    };
    p.appendChild(c);
  }
}
$("pickGroups").onclick = () => {
  const open = $("groupPicker").classList.toggle("hidden");
  $("pickGroups").textContent = open ? "Kana…" : "Done";
  renderPicker();
};
$("showChart").onclick = () => {
  const c = $("kanaChart");
  c.classList.toggle("hidden");
  c.innerHTML = chartHTML(selectedRows(), false, scriptOf(S).groups);
  $("showChart").textContent = c.classList.contains("hidden") ? "Chart" : "Hide chart";
};

/* ---------- vocab ---------- */
let vCur = null, vRevealed = false;
for (const t of ["All topics", ...[...new Set(VOCAB.map((w) => w.topic))].sort()]) $("topic").add(new Option(t, t));
// Words the Linux tutor taught only exist here if progress was imported.
$("deck").classList.toggle("hidden", !db.tutorWords.length);
function vocabPool() {
  if ($("deck").value === "tutor") return db.tutorWords.map((w) => ({ ...w, romaji: "", id: "word:" + w.kana }));
  const t = $("topic").value;
  return VOCAB.filter((w) => canRead(w, S) && (t === "All topics" || w.topic === t)).map((w) => ({ ...w, id: "word:" + w.kana }));
}
function nextVocab() {
  const pool = vocabPool(), ids = pool.map((w) => w.id);
  $("topic").classList.toggle("hidden", $("deck").value === "tutor");
  $("vocabInfo").textContent = `${ids.length} words · ${countDue(ids)} due`;
  vRevealed = false;
  $("vBack").classList.add("hidden");
  $("vHint").classList.remove("hidden");
  $("vMiss").classList.add("hidden"); $("vKnew").classList.add("hidden");
  if (!ids.length) {
    vCur = null;
    $("vFront").className = "word en"; $("vFront").style.fontFamily = ""; $("vFontName").textContent = "";
    $("vFront").textContent = $("deck").value === "tutor" ? "No tutor words yet." : "No words use only the kana you've picked yet. Add more rows in the Kana tab (Kana…). Katakana words appear once you study katakana rows.";
    $("vHint").classList.add("hidden");
    return;
  }
  vCur = pool.find((w) => w.id === pickNext(ids, vCur?.id));
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
  $("vHint").classList.add("hidden");
  $("vMiss").classList.remove("hidden"); $("vKnew").classList.remove("hidden");
  if (!jp || S.autoSay) say(vCur.kana);
}
function answerVocab(ok) { if (!vCur || !vRevealed) return; grade(vCur.id, ok); nextVocab(); }
$("vCard").onclick = revealVocab;
$("vKnew").onclick = () => answerVocab(true);
$("vMiss").onclick = () => answerVocab(false);
$("vSay").onclick = () => vCur && say(vCur.kana);
["deck", "direction", "topic"].forEach((id) => ($(id).onchange = () => { vCur = null; nextVocab(); }));
// Swipe the card after revealing: right = knew it, left = missed it.
let sx = null, sy = null;
$("vCard").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
$("vCard").addEventListener("touchend", (e) => {
  if (sx == null || !vRevealed) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  sx = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) answerVocab(dx > 0);
});

/* ---------- dictionary ---------- */
function renderDict() {
  const q = $("dictSearch").value.trim().toLowerCase();
  const norm = (x) => x.toLowerCase().replace(/[\s'-]/g, "");
  const onlyReadable = $("dictReadable").checked;
  const rows = VOCAB.filter((w) => {
    if (onlyReadable && !canRead(w, S)) return false;
    if (!q) return true;
    return w.kana.includes(q) || (w.kanji && w.kanji.includes(q)) || norm(w.romaji).includes(norm(q)) || w.en.toLowerCase().includes(q);
  });
  const can = VOCAB.filter((w) => canRead(w, S)).length;
  $("dictStatus").textContent = `${rows.length} shown · you can read ${can} of ${VOCAB.length}`;
  $("dictList").innerHTML = rows.slice(0, 400).map((w) =>
    `<button class="drow${canRead(w, S) ? "" : " locked"}" data-say="${esc(w.kana)}"><span class="top"><span class="jp">${esc(w.kana)}</span>${w.kanji ? `<span class="kanji">${esc(w.kanji)}</span>` : ""}<span class="romaji">${esc(w.romaji)}</span></span><span class="en">${esc(w.en)}</span><span class="meta">${esc(w.topic)} · tap to hear</span></button>`
  ).join("");
}
$("dictSearch").addEventListener("input", renderDict);
$("dictReadable").onchange = renderDict;
$("dictList").addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) say(b.dataset.say); });

/* ---------- progress ---------- */
function renderProgress() {
  const solidOf = (groups) => {
    const all = groups.flatMap((g) => g.cards.map(([k]) => k));
    return `${all.filter((k) => (db.items["kana:" + k]?.box || 0) >= MASTERED_BOX).length} / ${all.length}`;
  };
  const kjs = kanjiSolid();
  const words = Object.entries(db.items).filter(([id, it]) => id.startsWith("word:") && it.box >= MASTERED_BOX).length;
  const todayRec = db.days[today()] || {};
  const stat = (b, s) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`;
  $("stats").innerHTML = [
    stat(streak(), "day streak"),
    stat(`${Math.round((todayRec.sec || 0) / 60)} / ${S.dailyGoalMin}`, "minutes today"),
    stat(solidOf(GROUPS), "hiragana solid"),
    stat(solidOf(KATA_GROUPS), "katakana solid"),
    stat(`${kjs.solid} / ${kjs.total}`, "kanji solid"),
    stat(words, "words solid"),
  ].join("");
  const mins = (i) => (db.days[today(Date.now() - i * 864e5)]?.sec || 0) / 60;
  const max = Math.max(S.dailyGoalMin, ...Array.from({ length: 14 }, (_, i) => mins(i)));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const m = mins(i);
    days.push(`<div class="day${m >= S.dailyGoalMin ? " goal" : ""}"><i style="height:${(m / max) * 100}%"></i>${new Date(Date.now() - i * 864e5).getDate()}</div>`);
  }
  $("days").innerHTML = days.join("");
  $("kanaGrid").innerHTML = chartHTML(GROUPS.map((g) => g.name), true);
  $("kataGrid").innerHTML = chartHTML(KATA_GROUPS.map((g) => g.name), true, KATA_GROUPS);
  $("kanjiGrid").innerHTML = kanjiGridHTML(null, true);
  const conf = Object.entries(db.confusions || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("confusions").innerHTML = conf.map(([pair, n]) => {
    const [a, b] = pair.split("|");
    return `<div class="m"><span class="jp">${a}</span> <i class="romaji">${KANA[a]?.romaji || ""}</i> ⇄ <span class="jp">${b}</span> <i class="romaji">${KANA[b]?.romaji || ""}</i> <span class="muted small">· ${n}×</span></div>`;
  }).join("") || '<p class="muted">None yet. Try Trip Up in the Kana tab.</p>';
}

/* ---------- settings ---------- */
const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
$("installHelp").classList.toggle("hidden", !!standalone);
document.querySelectorAll('input[name="fontMode"]').forEach((r) => {
  r.checked = r.value === S.fontMode;
  r.onchange = () => { S.fontMode = r.value; save(); kanaCur = null; vCur = null; trip = null; };
});
$("fontSamples").innerHTML = FONTS.map((f) => `<span><b style="font-family:${f.family.replace(/"/g, "'")}">あきさ</b>${esc(f.name.split(" (")[0])}</span>`).join("");
$("jaRate").value = S.jaRate; $("jaRateVal").textContent = S.jaRate + "×";
$("jaRate").oninput = () => { S.jaRate = +$("jaRate").value; $("jaRateVal").textContent = S.jaRate + "×"; save(); };
$("autoSay").checked = !!S.autoSay;
$("autoSay").onchange = () => { S.autoSay = $("autoSay").checked; save(); };
$("testVoice").onclick = () => {
  loadVoices();
  const v = jaVoice();
  $("voiceCheck").textContent = !tts ? "Speech isn't available here." : v ? `Voice: ${v.name}` : "No Japanese voice found on this device.";
  say("こんにちは。にほんごの れんしゅうを しましょう。");
};
$("dailyGoal").value = S.dailyGoalMin;
$("dailyGoal").onchange = () => { S.dailyGoalMin = Math.max(5, +$("dailyGoal").value || 30); save(); };
/* ---------- lessons ---------- */
var lessons = mountLessons($("lessons"), {
  say,
  onKanaAdded: () => { kanaCur = null; vCur = null; trip = null; },
});

$("ver").textContent = VERSION;

$("exportBtn").onclick = async () => {
  const name = `japanese-progress-${today()}.json`;
  const file = new File([exportJSON()], name, { type: "application/json" });
  // The share sheet lets you save to Files, AirDrop it to the laptop, etc.
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); $("backupMsg").textContent = ""; return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("importFile").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  if (!confirm("Replace the progress on this phone with the file's progress?")) return;
  try { importJSON(await f.text()); location.reload(); }
  catch (err) { $("backupMsg").textContent = "Import failed: " + err.message; }
};

/* ---------- kanji ---------- */
const kj = initKanji({ S, say, isActive: () => currentTab === "kanji", autoSay: () => S.autoSay });

/* ---------- start ---------- */
showKanaMode(false);
window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });
// Ask Safari not to clear saved progress when storage gets tight.
navigator.storage?.persist?.().catch(() => {});
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
