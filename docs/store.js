// Progress and settings, kept in this browser's localStorage.
// Everything lives under one key so it can be exported/imported as a single file.

const KEY = "jp-tutor-v1";
const DAY = 86400000;
// Leitner boxes: how long to wait before showing an item again.
const INTERVALS = [0, 10 * 60000, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 90 * DAY];
export const MASTERED_BOX = 4;

function blank() {
  return {
    version: 1,
    settings: {
      apiKey: "",
      model: "claude-opus-5-5",
      effort: "low",
      speakReplies: true,
      handsFree: false,
      micLang: "ja-JP",
      jaRate: 0.85,
      showRomaji: true,
      fontMode: "textbook", // "textbook" or "variable"
      studyGroups: ["Vowels", "K", "S"],
      dailyGoalMin: 30,
    },
    items: {},        // "kana:か" / "word:ねこ" -> {box, due, right, wrong, last}
    tutorWords: [],   // words the tutor taught: {kana, kanji, en, added}
    mistakes: [],     // {at, said, correction, explanation, category}
    notes: "",        // the tutor's running notes about the learner
    days: {},         // "2026-11-20" -> {sec, reviews, msgs}
    sessions: [],     // [{id, mode, started, messages:[...]}], newest last
    usage: { inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 },
    lastActive: 0,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const b = blank();
      return { ...b, ...d, settings: { ...b.settings, ...(d.settings || {}) }, usage: { ...b.usage, ...(d.usage || {}) } };
    }
  } catch (e) { console.warn("Could not load progress", e); }
  return blank();
}

export const db = load();

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}
export function saveNow() {
  clearTimeout(saveTimer);
  try {
    // Keep storage bounded: last 30 sessions, last 300 mistakes.
    if (db.sessions.length > 30) db.sessions = db.sessions.slice(-30);
    if (db.mistakes.length > 300) db.mistakes = db.mistakes.slice(-300);
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) { console.warn("Could not save progress", e); }
}

export function today(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayRec(key = today()) {
  return (db.days[key] ||= { sec: 0, reviews: 0, msgs: 0 });
}

// Call on every real interaction. Time between interactions counts as study
// time if the gap is under 3 minutes (so idle tabs don't inflate it).
export function activity(kind) {
  const now = Date.now();
  const gap = now - (db.lastActive || 0);
  const rec = dayRec();
  if (gap > 0 && gap < 3 * 60000) rec.sec += Math.round(gap / 1000);
  else rec.sec += 5;
  if (kind === "review") rec.reviews++;
  if (kind === "msg") rec.msgs++;
  db.lastActive = now;
  save();
}

export function streak() {
  let n = 0;
  const t = Date.now();
  // Today counts if done; otherwise the streak is still alive from yesterday.
  let start = db.days[today(t)] ? 0 : 1;
  for (let i = start; ; i++) {
    if (db.days[today(t - i * DAY)]) n++;
    else break;
  }
  return n;
}

export function item(id) {
  return db.items[id];
}

export function grade(id, correct) {
  const it = (db.items[id] ||= { box: 0, due: 0, right: 0, wrong: 0, last: 0 });
  if (correct) { it.right++; it.box = Math.min(it.box + 1, INTERVALS.length - 1); }
  else { it.wrong++; it.box = Math.max(0, Math.min(it.box - 2, 1)); }
  it.last = Date.now();
  it.due = it.last + INTERVALS[it.box];
  activity("review");
}

// Pick the next item: overdue reviews first (oldest due first),
// then unseen items, then the least-recently seen.
export function pickNext(ids, avoid) {
  const now = Date.now();
  const pool = ids.length > 1 ? ids.filter((i) => i !== avoid) : ids;
  const due = pool.filter((i) => db.items[i] && db.items[i].due <= now)
    .sort((a, b) => db.items[a].due - db.items[b].due);
  if (due.length) return due[0];
  const fresh = pool.filter((i) => !db.items[i]);
  if (fresh.length) return fresh[Math.floor(Math.random() * Math.min(fresh.length, 5))];
  return pool.slice().sort((a, b) => db.items[a].due - db.items[b].due)[0];
}

export function countDue(ids) {
  const now = Date.now();
  return ids.filter((i) => db.items[i] && db.items[i].due <= now).length;
}

export function exportJSON() {
  const copy = JSON.parse(JSON.stringify(db));
  copy.settings.apiKey = ""; // never put the key in an export file
  return JSON.stringify(copy, null, 1);
}

export function importJSON(text) {
  const d = JSON.parse(text);
  if (!d || d.version !== 1 || typeof d.items !== "object") throw new Error("Not a progress file from this app.");
  const key = db.settings.apiKey;
  const b = blank();
  Object.keys(db).forEach((k) => delete db[k]);
  Object.assign(db, b, d, { settings: { ...b.settings, ...d.settings, apiKey: key } });
  saveNow();
}
