import { GROUPS, WORDS } from "./data.js";
import { KATA_WORDS } from "./katakana-words.js";

export { GROUPS };

// Katakana: the same rows as hiragana (same names, same romaji), plus the
// extra combinations used only for foreign words (ファ, ティ, ...).
export const toKata = (s) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const KATA_GROUPS = [
  ...GROUPS.map((g) => ({ name: g.name, cards: g.cards.map(([k, r]) => [toKata(k), r]) })),
  { name: "Extended (foreign sounds)", cards: [
    ["ファ", "fa"], ["フィ", "fi"], ["フェ", "fe"], ["フォ", "fo"], ["ティ", "ti"], ["ディ", "di"],
    ["トゥ", "tu"], ["ドゥ", "du"], ["デュ", "dyu"], ["ウィ", "wi"], ["ウェ", "we"], ["ウォ", "wo"],
    ["シェ", "she"], ["ジェ", "je"], ["チェ", "che"], ["ヴ", "vu"],
  ] },
];
// Each script's rows and which setting holds the rows being studied.
export const SCRIPTS = {
  hira: { label: "Hiragana", groups: GROUPS, setting: "studyGroups" },
  kata: { label: "Katakana", groups: KATA_GROUPS, setting: "kataGroups" },
};
export const scriptOf = (S) => SCRIPTS[S.kanaScript] || SCRIPTS.hira;
// The kana currently being studied in the Kana tab's script, as [kana, romaji] pairs.
export function studyCards(S) {
  const sc = scriptOf(S), on = S[sc.setting] || [];
  return sc.groups.filter((g) => on.includes(g.name)).flatMap((g) => g.cards);
}

export const KANA = {}; // "か" / "カ" -> {romaji, group, script}
for (const g of GROUPS) for (const [k, r] of g.cards) KANA[k] = { romaji: r, group: g.name, script: "hira" };
for (const g of KATA_GROUPS) for (const [k, r] of g.cards) KANA[k] = { romaji: r, group: g.name, script: "kata" };
const SMALL_TSU = new Set(["っ", "ッ"]);
const SMALL_TSU_GROUP = "T";
const LONG = "ー"; // katakana long-vowel mark: repeats the vowel before it

export function tokenize(word) {
  const out = [];
  for (let i = 0; i < word.length;) {
    const two = word.slice(i, i + 2);
    if (KANA[two]) { out.push(two); i += 2; }
    else if (KANA[word[i]] || SMALL_TSU.has(word[i]) || (word[i] === LONG && i > 0)) { out.push(word[i]); i++; }
    else return null;
  }
  return out;
}

export function toRomaji(word) {
  const t = tokenize(word) || [];
  return t.map((k, n) => {
    if (k === LONG) return (KANA[t[n - 1]]?.romaji || "").slice(-1);
    if (SMALL_TSU.has(k)) {
      const nxt = n + 1 < t.length ? KANA[t[n + 1]]?.romaji || "" : "";
      return nxt.startsWith("ch") ? "t" : nxt.slice(0, 1);
    }
    if (k === "ん" && n + 1 < t.length && "aiueoy".includes((KANA[t[n + 1]]?.romaji || "x")[0])) return "n'";
    return KANA[k].romaji;
  }).join("");
}

export function groupsFor(word) {
  return new Set((tokenize(word) || []).filter((k) => k !== LONG).map((k) => (SMALL_TSU.has(k) ? SMALL_TSU_GROUP : KANA[k].group)));
}

const isKata = (word) => /[\u30a1-\u30fa]/.test(word);
export const VOCAB = [...WORDS, ...KATA_WORDS].filter((w) => tokenize(w.kana)).map((w) => ({
  ...w, romaji: w.romaji || toRomaji(w.kana), groups: groupsFor(w.kana), script: isKata(w.kana) ? "kata" : "hira",
}));

export function readable(word, groups) {
  const g = new Set(groups);
  for (const x of word.groups || groupsFor(word.kana)) if (!g.has(x)) return false;
  return true;
}

// Can the learner read this word with the hiragana / katakana rows they study?
export function canRead(word, S) {
  return readable(word, word.script === "kata" ? S.kataGroups || [] : S.studyGroups);
}

// Accept common alternative spellings when typing romaji.
const ALT = {
  shi: ["si"], chi: ["ti"], tsu: ["tu"], fu: ["hu"], ji: ["zi", "di"], zu: ["du"],
  wo: ["o"], n: ["nn"], sha: ["sya"], shu: ["syu"], sho: ["syo"], cha: ["tya", "cya"],
  chu: ["tyu", "cyu"], cho: ["tyo", "cyo"], ja: ["zya", "jya"], ju: ["zyu", "jyu"], jo: ["zyo", "jyo"],
};
export function romajiMatches(answer, romaji) {
  const a = answer.trim().toLowerCase();
  return a === romaji || (ALT[romaji] || []).includes(a);
}

// Hiragana that learners commonly mix up because they look alike.
const LOOKALIKE_PAIRS = [
  "あお", "あめ", "ぬめ", "おむ", "いり", "いこ", "こに", "にた", "うら", "うつ", "らろ", "るろ",
  "さち", "さき", "きち", "けは", "はほ", "ほま", "まも", "ねれ", "ねわ", "れわ", "くへ", "すむ",
  "しつ", "そろ", "ゆよ", "ぬの", "てと", "そて",
  "ばぱ", "びぴ", "ぶぷ", "べぺ", "ぼぽ", "はば", "ひび", "ふぶ", "へべ", "ほぼ",
  "さざ", "ちぢ", "きぎ", "けげ",
];
const COMBO_BASES = "きしちにひみりぎじびぴ";
export const LOOKALIKES = {}; // kana -> Set of look-alikes
function link(a, b) {
  if (!KANA[a] || !KANA[b]) return;
  (LOOKALIKES[a] ||= new Set()).add(b);
  (LOOKALIKES[b] ||= new Set()).add(a);
}
for (const p of LOOKALIKE_PAIRS) { const [a, b] = [...p]; link(a, b); }
for (const c of COMBO_BASES) { link(c + "ゅ", c + "ょ"); link(c + "ゃ", c + "ゅ"); }
// Katakana look-alikes (シ/ツ and ソ/ン are the classic ones).
const KATA_LOOKALIKE_PAIRS = [
  "シツ", "ソン", "シン", "ソリ", "ツソ", "クタ", "クケ", "クワ", "ウワ", "ワフ", "フヌ", "ヌス", "ヌメ",
  "ナメ", "ノメ", "チテ", "コユ", "ユヨ", "コロ", "エユ", "ルレ", "マア", "アヤ", "セサ", "オホ",
  "ヲフ", "ラヲ", "ラウ", "ムス", "ケナ",
];
for (const p of KATA_LOOKALIKE_PAIRS) { const [a, b] = [...p]; link(a, b); }
// Dakuten pairs (ば/ぱ, は/ば, ...) look alike in both scripts.
for (const p of LOOKALIKE_PAIRS) {
  const [a, b] = [...p];
  if (a.normalize("NFD")[0] === b.normalize("NFD")[0]) link(toKata(a), toKata(b));
}
for (const c of COMBO_BASES) { const k = toKata(c); link(k + "ュ", k + "ョ"); link(k + "ャ", k + "ュ"); }

// Look-alikes of k that are inside the given set of kana.
export function lookalikesIn(k, inSet) {
  return [...(LOOKALIKES[k] || [])].filter((x) => inSet.has(x));
}
