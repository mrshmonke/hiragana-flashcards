// Lessons tab: course list, lesson reader and quiz. Used by both the Linux app
// (../app.js) and the iPhone app (ios/app.js); each passes its own `say`.
// Content lives in lessons.js. Progress is db.lessons[id] = {best, passed, tries, at}.
import { db, save, grade, activity } from "./store.js";
import { GROUPS, KANA, VOCAB, readable, romajiMatches } from "./kana.js";
import { UNITS, LESSONS, PASS_SCORE } from "./lessons.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const JP_RUN = /([぀-ヿ㐀-鿿　-〿！-～]+)/g;
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(JP_RUN, '<span class="jp">$1</span>');
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Romaji answers: ignore case, spaces, punctuation and macrons/long-vowel spellings.
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
// What to read aloud from an example: drop romaji-only placeholders, arrows and notes.
const speakable = (jp) => jp.replace(/\(.*?\)/g, "").replace(/[→+=\/]/g, "、").replace(/[a-zA-Z]/g, "").trim();

const AUTO_KANA_MAX = 15; // kana asked per lesson (big rows like combos are sampled)
const AUTO_WORDS = 3;     // "read this word" questions per kana lesson

const progress = () => (db.lessons ||= {});
const groupByName = Object.fromEntries(GROUPS.map((g) => [g.name, g]));

// Hiragana rows taught by this lesson and every lesson before it.
function groupsUpTo(lesson) {
  const out = [];
  for (const l of LESSONS) { out.push(...(l.groups || [])); if (l === lesson) break; }
  return out;
}

// Words that need this lesson's rows and are readable with everything so far.
function newlyReadable(lesson) {
  if (!lesson.groups) return [];
  const have = groupsUpTo(lesson), fresh = new Set(lesson.groups);
  return VOCAB.filter((w) => readable(w, have) && [...w.groups].some((g) => fresh.has(g)));
}

function buildQuiz(lesson) {
  const qs = [];
  if (lesson.groups) {
    const kana = shuffle(lesson.groups.flatMap((n) => (groupByName[n]?.cards || []).map(([k]) => k))).slice(0, AUTO_KANA_MAX);
    for (const k of kana) qs.push({ q: "Type the romaji", kana: k, type: [KANA[k].romaji] });
    for (const w of shuffle(newlyReadable(lesson)).slice(0, AUTO_WORDS)) {
      qs.push({ q: "Read this word", word: w, type: [w.romaji], why: `${w.kana} = ${w.en}` });
    }
  }
  return [...shuffle(qs), ...(lesson.quiz || [])];
}

export function lessonStats() {
  const p = progress();
  const passed = LESSONS.filter((l) => p[l.id]?.passed).length;
  const next = LESSONS.find((l) => !p[l.id]?.passed) || null;
  return { passed, total: LESSONS.length, next };
}

export function mountLessons(root, { say = () => {}, onKanaAdded = () => {} } = {}) {
  let view = "list", lesson = null, quiz = null;

  const isOpen = () => root.classList.contains("on");

  /* ---------- course list ---------- */
  function renderList() {
    view = "list";
    const p = progress();
    const { passed, total, next } = lessonStats();
    let h = `<div class="lsn-head"><div><b>${passed} of ${total}</b> lessons done</div>` +
      `<div class="lsn-meter"><i style="width:${(100 * passed) / total}%"></i></div>` +
      (next ? `<button class="primary" data-open="${next.id}">${passed ? "Continue" : "Start"}: ${esc(next.title)}</button>` : `<div class="muted">You've finished every lesson so far. More are on the way.</div>`) +
      `</div>`;
    let n = 0;
    for (const u of UNITS) {
      const ls = LESSONS.filter((l) => l.unit === u.id);
      if (!ls.length) continue;
      h += `<h3>${esc(u.title)}</h3><p class="muted small lsn-blurb">${esc(u.blurb)}</p><div class="lsn-list">`;
      for (const l of ls) {
        n++;
        const r = p[l.id];
        const state = r?.passed ? "done" : l === next ? "next" : r ? "tried" : "";
        const badge = r?.passed ? `✓ ${Math.round(r.best * 100)}%` : r ? `${Math.round(r.best * 100)}%` : `${l.minutes} min`;
        h += `<button class="lsn-row ${state}" data-open="${l.id}"><span class="n">${r?.passed ? "✓" : n}</span>` +
          `<span class="t">${inline(l.title)}</span><span class="b">${state === "next" ? "Next up" : badge}</span></button>`;
      }
      h += `</div>`;
    }
    root.innerHTML = h;
  }

  /* ---------- reading a lesson ---------- */
  function renderLesson(l) {
    view = "lesson"; lesson = l;
    const idx = LESSONS.indexOf(l);
    let h = `<div class="lsn-nav"><button class="ghost" data-back>← All lessons</button><span class="muted small">Lesson ${idx + 1} of ${LESSONS.length} · about ${l.minutes} min</span></div>` +
      `<h2 class="lsn-title">${inline(l.title)}</h2>`;
    for (const part of l.parts || []) {
      if (part.h) h += `<h3>${inline(part.h)}</h3>`;
      if (part.p) h += `<p>${inline(part.p)}</p>`;
      if (part.tip) h += `<div class="lsn-tip">${inline(part.tip)}</div>`;
      if (part.ex) {
        h += `<div class="lsn-ex">` + part.ex.map(([jp, ro, en]) =>
          `<div class="r"><button class="say" data-say="${esc(speakable(jp))}" title="Hear it" aria-label="Hear it">🔊</button>` +
          `<span class="jp">${esc(jp)}</span><span class="romaji">${esc(ro)}</span><span class="en">${inline(en)}</span></div>`).join("") + `</div>`;
      }
    }
    if (l.groups) {
      const words = newlyReadable(l);
      if (words.length) {
        h += `<h3>Words you can read now</h3><div class="lsn-ex">` + shuffle(words).slice(0, 10).map((w) =>
          `<div class="r"><button class="say" data-say="${esc(w.kana)}" title="Hear it" aria-label="Hear it">🔊</button>` +
          `<span class="jp">${esc(w.kana)}</span><span class="romaji">${esc(w.romaji)}</span><span class="en">${esc(w.en)}</span></div>`).join("") + `</div>`;
      }
    }
    const n = buildQuiz(l).length;
    h += `<div class="lsn-foot"><button class="primary wide" data-quiz>Start the quiz (${n} questions)</button>` +
      `<p class="muted small">Pass with ${Math.round(PASS_SCORE * 100)}% or more.${l.groups ? " Passing also adds these rows to your Kana practice." : ""}</p></div>`;
    root.innerHTML = h;
    root.scrollTop = 0; window.scrollTo?.(0, 0);
  }

  /* ---------- quiz ---------- */
  function startQuiz(l, only = null) {
    view = "quiz"; lesson = l;
    quiz = { items: only || buildQuiz(l), i: 0, right: 0, missed: [], answered: false, built: [], retry: !!only };
    renderQuestion();
  }

  function renderQuestion() {
    const it = quiz.items[quiz.i];
    quiz.answered = false; quiz.built = [];
    let h = `<div class="lsn-nav"><button class="ghost" data-leave>✕ Stop</button><span class="muted small">${esc(lesson.title)} · ${quiz.i + 1} / ${quiz.items.length}</span></div>` +
      `<div class="lsn-meter"><i style="width:${(100 * quiz.i) / quiz.items.length}%"></i></div><div class="card lsn-q">`;
    h += `<div class="q">${inline(it.q)}</div>`;
    if (it.kana) h += `<div class="kana-big">${esc(it.kana)}</div>`;
    if (it.word) h += `<div class="word">${esc(it.word.kana)}</div>`;
    if (it.choices) {
      it._order = shuffle(it.choices.map((_, i) => i));
      h += `<div class="lsn-choices">` + it._order.map((ci, n) =>
        `<button class="lsn-choice" data-choice="${ci}"><span class="k">${n + 1}</span> ${inline(it.choices[ci])}</button>`).join("") + `</div>`;
    } else if (it.type) {
      h += `<input class="lsn-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="romaji, then Enter">` +
        `<button class="primary" data-check>Check</button>`;
    } else if (it.build) {
      it._tiles = shuffle(it.build.map((w, i) => ({ w, i })));
      // Make sure the shuffle doesn't hand over the answer.
      if (it.build.length > 1 && it._tiles.every((t, n) => t.i === n)) it._tiles.push(it._tiles.shift());
      h += `<div class="lsn-built"></div><div class="lsn-tiles">` + it._tiles.map((t, n) =>
        `<button class="lsn-tile jp" data-tile="${n}">${esc(t.w)}</button>`).join("") + `</div>` +
        `<div class="row center"><button class="ghost" data-clear>Clear</button><button class="primary" data-check>Check</button></div>`;
    }
    h += `<div class="lsn-result"></div><div class="row center"><button class="primary hidden" data-next>Next (Enter)</button></div></div>`;
    root.innerHTML = h;
    const inp = root.querySelector(".lsn-input");
    if (inp) setTimeout(() => inp.focus(), 0);
  }

  function renderBuilt() {
    const it = quiz.items[quiz.i];
    root.querySelector(".lsn-built").innerHTML = quiz.built.map((n, pos) =>
      `<button class="lsn-tile jp" data-unbuild="${pos}">${esc(it._tiles[n].w)}</button>`).join("") || `<span class="muted small">Tap the words in order</span>`;
    root.querySelectorAll("[data-tile]").forEach((b) => b.classList.toggle("used", quiz.built.includes(+b.dataset.tile)));
  }

  function answer(ok, shown) {
    if (quiz.answered) return;
    const it = quiz.items[quiz.i];
    quiz.answered = true;
    if (ok) quiz.right++; else quiz.missed.push(it);
    if (it.kana) grade("kana:" + it.kana, ok); else activity("review");
    const res = root.querySelector(".lsn-result");
    res.className = "lsn-result " + (ok ? "ok" : "no");
    res.innerHTML = (ok ? "✓ Right." : `✗ The answer is <b>${inline(shown)}</b>.`) + (it.why ? `<div class="why">${inline(it.why)}</div>` : "");
    root.querySelectorAll("[data-check],[data-clear]").forEach((b) => b.classList.add("hidden"));
    root.querySelectorAll(".lsn-choice,.lsn-tile,.lsn-input").forEach((b) => (b.disabled = true));
    root.querySelector("[data-next]").classList.remove("hidden");
    root.querySelector("[data-next]").focus();
    if (it.kana) say(it.kana); else if (it.word) say(it.word.kana);
  }

  function check() {
    const it = quiz.items[quiz.i];
    if (it.type) {
      const v = root.querySelector(".lsn-input").value;
      if (!v.trim()) return;
      const ok = it.type.some((a) => norm(v) === norm(a) || (it.kana && romajiMatches(v, a)));
      answer(ok, it.type[0]);
    } else if (it.build) {
      if (!quiz.built.length) return;
      const got = quiz.built.map((n) => it._tiles[n].w).join("");
      answer(got === it.build.join(""), it.build.join(" "));
      if (got === it.build.join("")) say(it.build.join(""));
    }
  }

  function choose(ci) {
    const it = quiz.items[quiz.i];
    const ok = ci === it.a;
    root.querySelectorAll(".lsn-choice").forEach((b) => {
      const c = +b.dataset.choice;
      if (c === it.a) b.classList.add("right");
      else if (c === ci) b.classList.add("wrong");
    });
    answer(ok, it.choices[it.a]);
  }

  function nextQuestion() {
    quiz.i++;
    if (quiz.i < quiz.items.length) renderQuestion(); else finish();
  }

  function finish() {
    view = "done";
    const score = quiz.right / quiz.items.length;
    const p = progress();
    const r = (p[lesson.id] ||= { best: 0, passed: false, tries: 0, at: 0 });
    // A retry of only the missed questions can complete a pass but not raise the score above it.
    const effective = quiz.retry ? Math.min(1, (r.lastRight + quiz.right) / r.lastTotal) : score;
    if (!quiz.retry) { r.lastRight = quiz.right; r.lastTotal = quiz.items.length; }
    else r.lastRight += quiz.right;
    r.tries++; r.at = Date.now(); r.best = Math.max(r.best, effective);
    const passed = effective >= PASS_SCORE;
    const firstPass = passed && !r.passed;
    if (passed) r.passed = true;
    let added = [];
    if (passed && lesson.groups) {
      const S = db.settings;
      added = lesson.groups.filter((g) => groupByName[g] && !S.studyGroups.includes(g));
      if (added.length) { S.studyGroups = [...S.studyGroups, ...added]; onKanaAdded(added); }
    }
    save();
    const idx = LESSONS.indexOf(lesson), nxt = LESSONS[idx + 1];
    let h = `<div class="card lsn-done"><div class="big">${passed ? (firstPass ? "🎉" : "✓") : "…"}</div>` +
      `<h2>${quiz.right} of ${quiz.items.length} right${quiz.retry ? " on the retry" : ""}</h2>` +
      `<p>${passed ? (firstPass ? "Lesson passed." : "Passed.") : `Not quite. You need ${Math.round(PASS_SCORE * 100)}% to pass.`}` +
      `${added.length ? ` Added ${esc(added.join(", "))} to your Kana practice.` : ""}</p>`;
    if (quiz.missed.length) {
      h += `<div class="lsn-missed"><div class="muted small">To look at again:</div>` + quiz.missed.map((it) =>
        `<div>${it.kana ? `<span class="jp">${esc(it.kana)}</span> = ${esc(it.type[0])}` : it.word ? `<span class="jp">${esc(it.word.kana)}</span> = ${esc(it.word.romaji)} (${esc(it.word.en)})` : inline(it.q) + " → " + inline(it.choices ? it.choices[it.a] : it.build ? it.build.join(" ") : it.type[0])}</div>`).join("") + `</div>`;
    }
    h += `<div class="row center">` +
      (quiz.missed.length ? `<button data-retry>Retry the ${quiz.missed.length} missed</button>` : "") +
      `<button class="ghost" data-reread>Read the lesson again</button>` +
      (passed && nxt ? `<button class="primary" data-open="${nxt.id}">Next: ${inline(nxt.title)}</button>` : "") +
      `<button class="ghost" data-back>All lessons</button></div></div>`;
    root.innerHTML = h;
    root._missed = quiz.missed;
  }

  /* ---------- events ---------- */
  root.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.say !== undefined) return say(d.say);
    if (d.open) { const l = LESSONS.find((x) => x.id === d.open); if (l) renderLesson(l); return; }
    if (d.back !== undefined) return renderList();
    if (d.leave !== undefined) return renderLesson(lesson);
    if (d.reread !== undefined) return renderLesson(lesson);
    if (d.quiz !== undefined) return startQuiz(lesson);
    if (d.retry !== undefined) return startQuiz(lesson, shuffle(root._missed));
    if (d.next !== undefined) return nextQuestion();
    if (view !== "quiz" || quiz.answered) return;
    if (d.choice !== undefined) return choose(+d.choice);
    if (d.check !== undefined) return check();
    if (d.clear !== undefined) { quiz.built = []; return renderBuilt(); }
    if (d.tile !== undefined) { const n = +d.tile; if (!quiz.built.includes(n)) { quiz.built.push(n); renderBuilt(); } return; }
    if (d.unbuild !== undefined) { quiz.built.splice(+d.unbuild, 1); return renderBuilt(); }
  });

  document.addEventListener("keydown", (e) => {
    if (!isOpen() || view !== "quiz" || e.ctrlKey || e.metaKey || e.altKey) return;
    const it = quiz.items[quiz.i];
    if (e.key === "Enter") {
      e.preventDefault();
      if (quiz.answered) nextQuestion(); else check();
    } else if (!quiz.answered && it.choices && /^[1-9]$/.test(e.key) && e.target.tagName !== "INPUT") {
      const ci = it._order[+e.key - 1];
      if (ci !== undefined) choose(ci);
    }
  });

  renderList();
  return {
    // Called when the tab is shown: refresh the list unless mid-lesson.
    show() { if (view === "list") renderList(); },
  };
}
