import { GROUPS, WORDS } from "./data.js";

export { GROUPS };
export const KANA = {}; // "か" -> {romaji, group}
for (const g of GROUPS) for (const [k, r] of g.cards) KANA[k] = { romaji: r, group: g.name };
const SMALL_TSU = "っ";
const SMALL_TSU_GROUP = "T";

export function tokenize(word) {
  const out = [];
  for (let i = 0; i < word.length;) {
    const two = word.slice(i, i + 2);
    if (KANA[two]) { out.push(two); i += 2; }
    else if (KANA[word[i]] || word[i] === SMALL_TSU) { out.push(word[i]); i++; }
    else return null;
  }
  return out;
}

export function toRomaji(word) {
  const t = tokenize(word) || [];
  return t.map((k, n) => {
    if (k === SMALL_TSU) {
      const nxt = n + 1 < t.length ? KANA[t[n + 1]]?.romaji || "" : "";
      return nxt.startsWith("ch") ? "t" : nxt.slice(0, 1);
    }
    if (k === "ん" && n + 1 < t.length && "aiueoy".includes((KANA[t[n + 1]]?.romaji || "x")[0])) return "n'";
    return KANA[k].romaji;
  }).join("");
}

export function groupsFor(word) {
  return new Set((tokenize(word) || []).map((k) => (k === SMALL_TSU ? SMALL_TSU_GROUP : KANA[k].group)));
}

export const VOCAB = WORDS.filter((w) => tokenize(w.kana)).map((w) => ({
  ...w, romaji: w.romaji || toRomaji(w.kana), groups: groupsFor(w.kana),
}));

export function readable(word, groups) {
  const g = new Set(groups);
  for (const x of word.groups || groupsFor(word.kana)) if (!g.has(x)) return false;
  return true;
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

// Look-alikes of k that are inside the given set of kana.
export function lookalikesIn(k, inSet) {
  return [...(LOOKALIKES[k] || [])].filter((x) => inSet.has(x));
}
