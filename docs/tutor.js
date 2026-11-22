// The Claude tutor: system prompt, tools that write to progress, and the
// streaming tool-use loop. Calls the Claude API directly from the browser
// with the learner's own API key.
import Anthropic from "./vendor/anthropic-sdk-1.11.0.js";
import { db, save, MASTERED_BOX } from "./store.js";
import { GROUPS, KANA } from "./kana.js";

export const MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5 (best, default)", inPrice: 4, outPrice: 20, fallbacks: true },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (cheaper)", inPrice: 2, outPrice: 10, fallbacks: true },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5 (cheapest, fastest)", inPrice: 0.1, outPrice: 0.5, fallbacks: false },
];

export const MODES = {
  chat: {
    label: "Conversation",
    start: "Start a short, simple conversation with me in Japanese at my level. Ask me one question at a time.",
  },
  okinawa: {
    label: "Okinawa role-play",
    start: "Run a role-play set in daily life in Okinawa (pick a realistic scene: a neighbour, a shokudō, the bus, a beach clean-up, a shop). Play the local person, keep each of your lines short, and wait for my reply.",
  },
  drill: {
    label: "Kana & vocab drill",
    start: "Drill me on the kana and words I'm weakest at. Ask one item at a time, wait for my answer, then mark it right or wrong.",
  },
  anime: {
    label: "Anime line breakdown",
    start: "I want to break down lines from anime. Ask me for a line (or offer a common, simple one if I don't have one), then explain it word by word, including how natural or casual it is and whether I could say it in real life.",
  },
  ask: {
    label: "Ask anything",
    start: null,
  },
};

const TOOLS = [
  {
    name: "record_mistake",
    description: "Log a mistake the learner made so it is tracked and reviewed later. Call this for every real error (grammar, particle, vocabulary, politeness, kana, unnatural phrasing). Do not call it for speech-recognition glitches.",
    input_schema: {
      type: "object",
      properties: {
        said: { type: "string", description: "What the learner wrote or said." },
        correction: { type: "string", description: "The correct or natural version." },
        explanation: { type: "string", description: "One short sentence on why." },
        category: { type: "string", enum: ["grammar", "particle", "vocabulary", "politeness", "kana", "pronunciation", "naturalness", "other"] },
      },
      required: ["said", "correction", "explanation", "category"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "add_word",
    description: "Add a word or short phrase you taught to the learner's vocab review deck. Use it for genuinely useful words, not every word you use.",
    input_schema: {
      type: "object",
      properties: {
        kana: { type: "string", description: "Reading in hiragana/katakana." },
        kanji: { type: "string", description: "Usual written form with kanji, or empty string." },
        en: { type: "string", description: "Short English meaning." },
      },
      required: ["kana", "kanji", "en"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "update_learner_notes",
    description: "Replace your private running notes about this learner (level, recurring weaknesses, what to work on next, interests). These notes are shown to you at the start of every future session. Keep them under 1200 characters and keep what is still true.",
    input_schema: {
      type: "object",
      properties: { notes: { type: "string" } },
      required: ["notes"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
];

function runTool(name, input) {
  const str = (v) => typeof v === "string";
  if (name === "record_mistake") {
    if (!str(input?.said) || !str(input?.correction)) throw new Error("said and correction are required strings");
    db.mistakes.push({ at: Date.now(), said: input.said, correction: input.correction, explanation: input.explanation || "", category: input.category || "other" });
    save();
    return "Logged.";
  }
  if (name === "add_word") {
    if (!str(input?.kana) || !str(input?.en)) throw new Error("kana and en are required strings");
    if (!db.tutorWords.some((w) => w.kana === input.kana)) {
      db.tutorWords.push({ kana: input.kana, kanji: input.kanji || "", en: input.en, added: Date.now() });
      save();
    }
    return "Added to the review deck.";
  }
  if (name === "update_learner_notes") {
    if (!str(input?.notes)) throw new Error("notes must be a string");
    db.notes = input.notes.slice(0, 2000);
    save();
    return "Notes saved.";
  }
  throw new Error(`Unknown tool ${name}`);
}

function learnerSnapshot() {
  const s = db.settings;
  const mastered = [], learning = [], weak = [];
  for (const g of GROUPS) for (const [k] of g.cards) {
    const it = db.items["kana:" + k];
    if (!it) continue;
    if (it.box >= MASTERED_BOX) mastered.push(k);
    else learning.push(k);
    if (it.wrong >= 2 && it.wrong >= it.right / 2) weak.push(`${k} (${KANA[k].romaji})`);
  }
  const words = Object.entries(db.items).filter(([id, it]) => id.startsWith("word:") && it.box >= MASTERED_BOX).map(([id]) => id.slice(5));
  const recent = db.mistakes.slice(-15).map((m) => `- said "${m.said}" → "${m.correction}" (${m.category})`).join("\n");
  return [
    `Kana groups the learner is currently studying: ${s.studyGroups.join(", ")}.`,
    `Hiragana well known (from flashcard reviews): ${mastered.join("") || "none yet"}.`,
    `Hiragana still being learned: ${learning.join("") || "none"}.`,
    weak.length ? `Kana they often miss: ${weak.join(", ")}.` : "",
    Object.keys(db.confusions || {}).length ? `Look-alike kana they mix up (Trip Up drill): ${Object.entries(db.confusions).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p.replace("|", "/")} ${n}×`).join(", ")}.` : "",
    `Katakana: not studied yet.  Kanji: none yet.`,
    `Words solidly learned in review (${words.length}): ${words.slice(0, 80).join("、") || "none yet"}.`,
    recent ? `Recent mistakes:\n${recent}` : "No mistakes logged yet.",
    `Your notes from earlier sessions:\n${db.notes || "(none yet — start some with update_learner_notes once you have a sense of their level)"}`,
  ].filter(Boolean).join("\n");
}

function systemPrompt(mode) {
  const romaji = db.settings.showRomaji
    ? "After every line of Japanese, put its romaji in parentheses on the same line, e.g. こんにちは (konnichiwa). Then give the English meaning when it helps."
    : "Do not give romaji unless asked. Give English meanings only when needed.";
  return `You are a Japanese tutor for one adult learner. They are a native English speaker with a little Spanish and Mandarin (they understand how characters are built but remember almost none). They plan to move to Okinawa by 2031 and want Japanese for daily life and making friends, not for business or exams. They enjoy anime. They study 30–60 minutes a day at a desk and listen to audio for hours at work. They also use Duolingo and Pimsleur.

How to behave — this matters more than anything else:
- Be honest and direct. Do not flatter. Never open with praise. Do not say things like "Great job!", "Excellent!", "Perfect!", "You're doing amazing". If an answer is right, say "Correct." or just carry on. Praise only real, specific progress, and rarely.
- Correct every error, including small ones: particles, long vowels, small っ, politeness level, word choice, and things that are grammatical but unnatural. Show the corrected version. Don't bury corrections under encouragement.
- If they push back on a correction and they are wrong, hold your position and explain again. If you were wrong, say so plainly.
- When asked how they are doing, give a frank assessment with specifics, including what is weak.
- Don't pad replies. Keep them short; in conversation and role-play, one to three short Japanese lines plus brief corrections.
- Stay warm and patient in tone. Directness is not rudeness.

Language rules:
- Use only Japanese they can plausibly handle; stretch them slightly. Prefer hiragana. Avoid kanji unless they ask; if a kanji word matters, write it in kana and mention the kanji once. Write katakana loanwords in katakana with the reading, since they haven't studied katakana.
- ${romaji}
- Default to polite です/ます Japanese, and point out when friends would say it more casually. Teach standard Japanese. You may mention common Okinawan words (はいさい, めんそーれ, なんくるないさ) as culture, clearly labelled as Okinawan dialect.
- Replies are read aloud by text-to-speech, so avoid tables and heavy formatting. Short bullet lists are fine.
- Messages that begin with [spoken] came through speech recognition. Odd words there may be recognition errors rather than mistakes; if a word looks misheard, say it may have been unclear and what you think they meant. Mispronunciation can show up as wrong words, so mention it when likely.

Tracking (the app saves these to their progress):
- Call record_mistake for each real mistake, in the same turn you correct it.
- Call add_word when you teach a genuinely useful new word.
- Near the end of a session, or after you learn something important about their level, call update_learner_notes with updated notes.
- Use tools quietly; don't mention them in your reply.
- Call tools only through the API's tool use. Never write tool calls, XML tags or <invoke> markup in your reply text; the learner would see it.

Current session mode: ${MODES[mode]?.label || "Conversation"}.

What the app knows about the learner right now:
${learnerSnapshot()}`;
}

let client = null, clientKey = "";
function getClient() {
  const key = db.settings.apiKey.trim();
  if (!key) throw new Error("Add your Claude API key in Settings first.");
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

let noFallbacks = false; // set if the account rejects the server-side fallback beta

export function newSession(mode) {
  const s = { id: Date.now().toString(36), mode, started: Date.now(), system: systemPrompt(mode), messages: [] };
  db.sessions.push(s);
  save();
  return s;
}

function addUsage(u, m) {
  if (!u) return;
  db.usage.cost = (db.usage.cost || 0) + ((u.input_tokens || 0) * m.inPrice + (u.cache_creation_input_tokens || 0) * m.inPrice * 1.25
    + (u.cache_read_input_tokens || 0) * m.inPrice * 0.1 + (u.output_tokens || 0) * m.outPrice) / 1e6;
  db.usage.inTok += u.input_tokens || 0;
  db.usage.outTok += u.output_tokens || 0;
  db.usage.cacheRead += u.cache_read_input_tokens || 0;
  db.usage.cacheWrite += u.cache_creation_input_tokens || 0;
}

// Send the learner's message and stream the reply.
// onText(fullTextSoFar) is called as text arrives. Returns the final reply text.
export async function send(session, userText, { onText, signal } = {}) {
  const c = getClient();
  const base = session.messages.length; // to roll back cleanly on failure
  session.messages.push({ role: "user", content: userText });
  save();
  let shown = "";
  for (let round = 0; round < 6; round++) {
    const model = MODELS.find((m) => m.id === db.settings.model) || MODELS[0];
    const params = {
      model: model.id,
      max_tokens: 16000,
      system: session.system,
      messages: session.messages,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      cache_control: { type: "ephemeral" },
      output_config: { effort: db.settings.effort || "low" },
    };
    if (model.fallbacks && !noFallbacks) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    let msg;
    try {
      msg = await streamOnce(c, params, signal, (t) => onText?.(shown + (shown ? "\n\n" : "") + visible(t)));
    } catch (e) {
      if (params.fallbacks && e?.status === 400 && /fallback/i.test(e.message || "")) {
        noFallbacks = true;
        round--;
        continue;
      }
      // Leave history valid: drop this whole exchange on failure.
      session.messages.length = base;
      save();
      throw friendlyError(e);
    }
    addUsage(msg.usage, model);
    // Run tool calls the model wrote as text, and remove that markup from the
    // reply and from history (so the model doesn't copy it later).
    for (const b of msg.content) {
      if (b.type !== "text") continue;
      const { clean, calls } = extractLeakedCalls(b.text);
      if (!calls.length && clean === b.text.trim()) continue;
      b.text = clean;
      for (const call of calls) {
        if (!TOOL_NAMES.has(call.name)) continue;
        try { runTool(call.name, call.input); } catch (err) { console.warn("leaked tool call failed", call, err); }
      }
    }
    msg.content = msg.content.filter((b) => b.type !== "text" || b.text);
    if (!msg.content.length) msg.content = [{ type: "text", text: "(noted)" }];
    // Keep the full content (including thinking blocks) in history.
    session.messages.push({ role: "assistant", content: msg.content });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (text) shown += (shown ? "\n\n" : "") + text;
    onText?.(shown);
    if (msg.stop_reason === "refusal") {
      shown += (shown ? "\n\n" : "") + "_(Claude declined to answer that one. Try rephrasing.)_";
      onText?.(shown);
      // A refused exchange can't be continued; drop it so the session stays usable.
      session.messages.length = base;
      break;
    }
    if (msg.stop_reason !== "tool_use") break;
    const results = [];
    for (const b of msg.content) {
      if (b.type !== "tool_use") continue;
      try {
        results.push({ type: "tool_result", tool_use_id: b.id, content: runTool(b.name, b.input) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: `Error: ${err.message}`, is_error: true });
      }
    }
    session.messages.push({ role: "user", content: results });
  }
  save();
  return shown;
}

// Sometimes a model writes a tool call as text (<invoke name="add_word">…).
// Run those calls anyway and keep the markup out of what the learner sees.
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const INVOKE_RE = /<(?:[\w-]+:)?invoke\s+name="([\w-]+)"\s*>([\s\S]*?)<\/(?:[\w-]+:)?invoke>/g;
const PARAM_RE = /<(?:[\w-]+:)?parameter\s+name="([\w-]+)"\s*>([\s\S]*?)<\/(?:[\w-]+:)?parameter>/g;
const WRAPPER_RE = /<\/?(?:[\w-]+:)?function_calls>/g;
export function extractLeakedCalls(text) {
  const calls = [];
  let clean = text.replace(INVOKE_RE, (_m, name, body) => {
    const input = {};
    for (const p of body.matchAll(PARAM_RE)) input[p[1]] = p[2].trim();
    calls.push({ name, input });
    return "";
  }).replace(WRAPPER_RE, "");
  // While streaming, hide a call that has started but not finished yet.
  const open = clean.search(/<(?:[\w-]+:)?(?:invoke|function_calls)\b/);
  if (open >= 0) clean = clean.slice(0, open);
  clean = clean.replace(/\n\s*[↓⬇]\s*$/, "").replace(/\n{3,}/g, "\n\n").trim();
  return { clean, calls };
}
const visible = (t) => extractLeakedCalls(t).clean;

async function streamOnce(c, params, signal, onText) {
  const stream = c.beta.messages.stream(params, { signal });
  let text = "";
  stream.on("text", (delta) => { text += delta; onText(text); });
  return await stream.finalMessage();
}

function friendlyError(e) {
  const s = e?.status;
  if (s === 401) return new Error("Claude rejected the API key. Check it in Settings.");
  if (s === 403) return new Error("This API key isn't allowed to use that model. Try another model in Settings.");
  if (s === 429) return new Error("Rate limited or out of credit. Check your balance at console.anthropic.com, then try again.");
  if (s === 529 || s >= 500) return new Error("Claude is overloaded right now. Try again in a moment.");
  if (e?.name === "AbortError" || /abort/i.test(e?.message || "")) return new Error("Stopped.");
  if (/fetch|network/i.test(e?.message || "")) return new Error("Couldn't reach Claude. Check your internet connection.");
  return new Error(e?.message || String(e));
}

export function costSoFar() {
  // Estimated from token counts and list prices; your Anthropic console has the exact bill.
  return db.usage.cost || 0;
}
