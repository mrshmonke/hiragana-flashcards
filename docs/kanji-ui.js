// Kanji tab, shared by the Linux app and the iPhone app. Both pages use the
// same element ids (kj...); the Linux page also has a "Show answer" button.
import { db, save, grade, pickNext, countDue, MASTERED_BOX } from "./store.js";
import { KANJI, KANJI_GROUPS } from "./kanji.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BY_CHAR = Object.fromEntries(KANJI.map((x) => [x.k, x]));

const masteryClass = (k) => {
  const it = db.items["kanji:" + k];
  return !it ? "" : it.box >= MASTERED_BOX ? "b4" : it.box >= 2 ? "b2" : "b1";
};

// Grid of kanji with their meanings, coloured by how well they're sticking.
export function kanjiGridHTML(groupNames, withMastery) {
  return KANJI_GROUPS.filter((g) => !groupNames || groupNames.includes(g.name)).map((g) =>
    `<div class="chart-title">${esc(g.name)}</div><div class="kgrid">${g.list.map((x) =>
      `<button class="kcell ${withMastery ? masteryClass(x.k) : ""}" data-kanji="${x.k}"><span class="k">${x.k}</span><span class="m">${esc(x.en.split(/[;,]/)[0])}</span></button>`
    ).join("")}</div>`).join("");
}

export function kanjiSolid() {
  return { solid: KANJI.filter((x) => (db.items["kanji:" + x.k]?.box || 0) >= MASTERED_BOX).length, total: KANJI.length };
}

// Meaning, readings and example words for one kanji.
export function kanjiDetailHTML(x, withKanji) {
  const rd = (label, v, tip) => v ? `<div class="kread"><span class="lbl" title="${tip}">${label}</span> <span class="jp">${esc(v)}</span></div>` : "";
  return (withKanji ? `<div class="kanji-mid">${x.k}</div>` : `<div class="kmean">${esc(x.en)}</div>`)
    + rd("on", x.on, "Reading from Chinese, mostly used in words of two or more kanji")
    + rd("kun", x.kun, "Native Japanese reading, often used when the kanji stands alone")
    + `<div class="kex">${x.ex.map((e) =>
      `<button class="kexw" data-say="${esc(e.r)}"><span class="jp">${esc(e.w)}</span> <span class="jp r">${esc(e.r)}</span> <span class="en">${esc(e.en)}</span></button>`
    ).join("")}</div>`;
}

export function initKanji({ S, say, isActive = () => true, autoSay = () => false }) {
  S.kanjiSets ||= [KANJI_GROUPS[0].name];
  S.kanjiDir ||= "kanji";
  let cur = null, revealed = false;

  const ids = () => KANJI.filter((x) => S.kanjiSets.includes(x.group)).map((x) => "kanji:" + x.k);

  function next() {
    const all = ids();
    $("kjInfo").textContent = `${all.length} kanji · ${countDue(all)} due · ${all.filter((i) => !db.items[i]).length} new`;
    revealed = false;
    $("kjBack").classList.add("hidden");
    $("kjBack").innerHTML = "";
    $("kjReveal")?.classList.remove("hidden");
    $("kjHint")?.classList.remove("hidden");
    $("kjMiss").classList.add("hidden"); $("kjKnew").classList.add("hidden");
    const id = pickNext(all, cur ? "kanji:" + cur.k : null);
    cur = id ? BY_CHAR[id.slice(6)] : null;
    if (!cur) { $("kjFront").textContent = ""; return; }
    const kanjiFirst = S.kanjiDir !== "meaning";
    $("kjFront").className = kanjiFirst ? "kanji-big" : "word en";
    $("kjFront").textContent = kanjiFirst ? cur.k : cur.en;
  }
  function reveal() {
    if (!cur || revealed) return;
    revealed = true;
    $("kjBack").innerHTML = kanjiDetailHTML(cur, S.kanjiDir === "meaning");
    $("kjBack").classList.remove("hidden");
    $("kjReveal")?.classList.add("hidden");
    $("kjHint")?.classList.add("hidden");
    $("kjMiss").classList.remove("hidden"); $("kjKnew").classList.remove("hidden");
    if (autoSay()) say(cur.ex[0].r);
  }
  function answer(ok) { if (!cur || !revealed) return; grade("kanji:" + cur.k, ok); next(); }

  function renderPicker() {
    const p = $("kjPicker");
    p.innerHTML = "";
    for (const g of KANJI_GROUPS) {
      const c = document.createElement("button");
      c.className = "chip" + (S.kanjiSets.includes(g.name) ? " on" : "");
      c.innerHTML = `${esc(g.name)} <span class="jp">${g.list.slice(0, 5).map((x) => x.k).join("")}${g.list.length > 5 ? "…" : ""}</span>`;
      c.onclick = () => {
        const on = S.kanjiSets.includes(g.name);
        if (on && S.kanjiSets.length === 1) return;
        S.kanjiSets = on ? S.kanjiSets.filter((n) => n !== g.name) : [...S.kanjiSets, g.name];
        save(); renderPicker(); cur = null; next();
        if (!$("kjList").classList.contains("hidden")) $("kjList").innerHTML = kanjiGridHTML(S.kanjiSets, true);
      };
      p.appendChild(c);
    }
  }

  $("kjDir").value = S.kanjiDir;
  $("kjDir").onchange = () => { S.kanjiDir = $("kjDir").value; save(); cur = null; next(); };
  $("kjPick").onclick = () => {
    const hidden = $("kjPicker").classList.toggle("hidden");
    $("kjPick").textContent = hidden ? "Kanji sets…" : "Done";
    renderPicker();
  };
  $("kjListBtn").onclick = () => {
    const l = $("kjList");
    l.classList.toggle("hidden");
    l.innerHTML = kanjiGridHTML(S.kanjiSets, true);
    $("kjListBtn").textContent = l.classList.contains("hidden") ? "List" : "Hide list";
  };
  // Tap a kanji in the list to see its readings and examples.
  // Works in any grid from kanjiGridHTML (the list here and the Progress tab).
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".kcell[data-kanji]");
    if (!b) return;
    const open = b.parentElement.nextElementSibling;
    const host = b.parentElement.parentElement;
    const same = open?.classList.contains("kopen") && open.dataset.k === b.dataset.kanji;
    host.querySelectorAll(".kopen").forEach((x) => x.remove());
    if (same) return;
    const d = document.createElement("div");
    d.className = "kopen back"; d.dataset.k = b.dataset.kanji;
    d.innerHTML = kanjiDetailHTML(BY_CHAR[b.dataset.kanji], true);
    b.parentElement.after(d);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".kexw[data-say]");
    if (b) { e.stopPropagation(); say(b.dataset.say); }
  }, true);
  $("kjReveal") && ($("kjReveal").onclick = reveal);
  $("kjCard").addEventListener("click", (e) => { if (!e.target.closest("button")) reveal(); });
  $("kjKnew").onclick = () => answer(true);
  $("kjMiss").onclick = () => answer(false);
  $("kjSay").onclick = () => cur && say(cur.ex[0].r);
  document.addEventListener("keydown", (e) => {
    if (!isActive() || e.target.matches("input, textarea, select")) return;
    if (e.key === " ") { e.preventDefault(); reveal(); }
    else if (e.key === "ArrowRight" || e.key === "1") answer(true);
    else if (e.key === "ArrowLeft" || e.key === "2") answer(false);
  });
  // Swipe after revealing: right = knew it, left = missed it.
  let sx = null, sy = null;
  $("kjCard").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $("kjCard").addEventListener("touchend", (e) => {
    if (sx == null || !revealed) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) answer(dx > 0);
  });

  return { show() { if (!cur) next(); } };
}
