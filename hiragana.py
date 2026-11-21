#!/usr/bin/python3
"""Japanese Tutor for Ubuntu: a Claude tutor you can talk to, plus kana,
vocab, dictionary and progress, in one window.

The window hosts the tutor UI (the repo's docs/ folder) in WebKitGTK, served
on 127.0.0.1 by a small local helper (voice-helper/jp_voice.py) that also does
offline speech: Whisper to hear you, Open JTalk and Piper to talk back.
If WebKitGTK isn't installed, it falls back to the original GTK flashcards."""
import io
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GLib  # noqa: E402

APP_VERSION = 8
APP_ID = "io.github.mrshmonke.HiraganaFlashcards"
UPDATE_URL = ("https://raw.githubusercontent.com/mrshmonke/"
              "hiragana-flashcards/main/hiragana.py")
REPO_TARBALL = ("https://codeload.github.com/mrshmonke/"
                "hiragana-flashcards/tar.gz/refs/heads/main")
TUTOR_HOME = os.path.join(os.path.expanduser("~"), ".local", "share", "japanese-tutor")
TUTOR_APP = os.path.join(TUTOR_HOME, "app")
HELPER_DIR = os.path.join(TUTOR_HOME, "voice-helper")
HELPER_PY = os.path.join(TUTOR_HOME, "venv", "bin", "python")
HELPER_URL = "http://127.0.0.1:8770"
HELPER_VERSION = 2   # restart a running helper older than this (after updates)
STAMP = os.path.join(TUTOR_HOME, "app-version")

try:
    try:
        gi.require_version("WebKit2", "4.1")
    except ValueError:
        gi.require_version("WebKit2", "4.0")
    from gi.repository import WebKit2  # noqa: E402
except (ValueError, ImportError):
    WebKit2 = None
# Textbook-style kana font (Klee One, SIL Open Font License), like a printed
# hiragana chart. Downloaded once into the user's font folder.
FONT_URL = ("https://raw.githubusercontent.com/google/fonts/main/"
            "ofl/kleeone/KleeOne-SemiBold.ttf")
FONT_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "fonts")
FONT_FILE = os.path.join(FONT_DIR, "KleeOne-SemiBold.ttf")
# Readings that break their row's pattern, marked * as in textbook charts.
IRREGULAR = {"shi", "chi", "tsu"}

GROUPS = [
    ("Vowels", "あa いi うu えe おo"),
    ("K", "かka きki くku けke こko"),
    ("S", "さsa しshi すsu せse そso"),
    ("T", "たta ちchi つtsu てte とto"),
    ("N", "なna にni ぬnu ねne のno"),
    ("H", "はha ひhi ふfu へhe ほho"),
    ("M", "まma みmi むmu めme もmo"),
    ("Y", "やya ゆyu よyo"),
    ("R", "らra りri るru れre ろro"),
    ("W + n", "わwa をwo んn"),
    ("G (dakuten)", "がga ぎgi ぐgu げge ごgo"),
    ("Z (dakuten)", "ざza じji ずzu ぜze ぞzo"),
    ("D (dakuten)", "だda ぢji づzu でde どdo"),
    ("B (dakuten)", "ばba びbi ぶbu べbe ぼbo"),
    ("P (handakuten)", "ぱpa ぴpi ぷpu ぺpe ぽpo"),
    ("Combos K S T N", "きゃkya きゅkyu きょkyo しゃsha しゅshu しょsho "
                       "ちゃcha ちゅchu ちょcho にゃnya にゅnyu にょnyo"),
    ("Combos H M R", "ひゃhya ひゅhyu ひょhyo みゃmya みゅmyu みょmyo "
                     "りゃrya りゅryu りょryo"),
    ("Combos G J B P", "ぎゃgya ぎゅgyu ぎょgyo じゃja じゅju じょjo "
                       "びゃbya びゅbyu びょbyo ぴゃpya ぴゅpyu ぴょpyo"),
]

# Words: kana | English | kanji (blank if usually written in kana) | topic
# | optional romaji (only where the automatic romaji would be wrong or
# hard to read, e.g. the particle は read as "wa").
# Every word uses hiragana only, so you can read it with the rows above.
WORDS = """
あい|love|愛|Feelings
あお|blue|青|Colors
あおい|blue (adjective)|青い|Colors
あか|red|赤|Colors
あかい|red (adjective)|赤い|Colors
あき|autumn|秋|Time
あさ|morning|朝|Time
あし|leg, foot|足|Body
あせ|sweat|汗|Body
いえ|house, home|家|Places
いいえ|no||Phrases
ええ|yes (soft)||Phrases
いか|squid||Food
いく|to go|行く|Verbs
いけ|pond|池|Nature
いす|chair|椅子|Things
いし|stone|石|Nature
うえ|above, up|上|Places
うし|cow|牛|Animals
うそ|a lie; "No way!"|嘘|Anime
え|picture, drawing|絵|Things
えき|train station|駅|Places
おい|"Hey!" (rough)||Anime
おおきい|big|大きい|Adjectives
おか|hill|丘|Nature
おかし|sweets, snacks|お菓子|Food
おさけ|alcohol, sake|お酒|Food
かい|shellfish|貝|Food
かお|face|顔|Body
かき|persimmon|柿|Food
かく|to write|書く|Verbs
かさ|umbrella|傘|Things
き|tree|木|Nature
きく|to listen; to ask|聞く|Verbs
くうき|air|空気|Nature
くさ|grass|草|Nature
こい|romantic love|恋|Feelings
こえ|voice|声|Body
ここ|here||Places
そこ|there||Places
あそこ|over there||Places
さけ|salmon|鮭|Food
さか|slope|坂|Places
しお|salt|塩|Food
しか|deer|鹿|Animals
すいか|watermelon|西瓜|Food
すき|to like|好き|Feelings
すし|sushi|寿司|Food
すこし|a little|少し|Phrases
せかい|world|世界|Places
せき|seat|席|Things
そうか|"I see." (casual)||Anime
おはよう|good morning (casual)||Greetings
おはようございます|good morning (polite)||Greetings|ohayou gozaimasu
こんにちは|hello, good afternoon||Greetings|konnichiwa
こんばんは|good evening||Greetings|konbanwa
おやすみ|good night||Greetings
さようなら|goodbye||Greetings
じゃあね|bye! (casual)||Greetings
またね|see you!||Greetings
ありがとう|thank you||Greetings
ありがとうございます|thank you very much||Greetings|arigatou gozaimasu
すみません|excuse me; sorry||Greetings
ごめんなさい|I'm sorry||Greetings
いただきます|said before eating||Greetings
ごちそうさま|said after eating||Greetings
はじめまして|nice to meet you||Greetings
よろしくおねがいします|please treat me well||Greetings|yoroshiku onegaishimasu
おげんきですか|how are you?|お元気ですか|Greetings|o-genki desu ka
いってきます|I'm off (leaving home)|行ってきます|Greetings
いってらっしゃい|see you later (to someone leaving)||Greetings
ただいま|I'm home||Greetings
おかえり|welcome home||Greetings
おめでとう|congratulations||Greetings
はいさい|hello (Okinawan, used by men)||Okinawa
はいたい|hello (Okinawan, used by women)||Okinawa
なんくるないさ|it'll work out somehow (Okinawan)||Okinawa|nankuru nai sa
ちゅらうみ|beautiful sea (Okinawan)|美ら海|Okinawa
おきなわ|Okinawa|沖縄|Okinawa
なは|Naha (Okinawa's capital)|那覇|Okinawa
さとうきび|sugarcane||Okinawa
あわもり|awamori (Okinawan liquor)|泡盛|Okinawa
ちんすこう|chinsuko (Okinawan shortbread)||Okinawa
さんしん|sanshin (Okinawan 3-string instrument)|三線|Okinawa
さんご|coral|珊瑚|Okinawa
たいふう|typhoon|台風|Okinawa
しま|island|島|Okinawa
うみ|sea, ocean|海|Nature
すな|sand|砂|Nature
わたし|I, me|私|People
あなた|you||People
ともだち|friend|友達|People
かぞく|family|家族|People
ひと|person|人|People
みんな|everyone||People
せんせい|teacher|先生|People
せんぱい|senpai (someone senior to you)|先輩|Anime
こうはい|kouhai (someone junior to you)|後輩|People
おとこ|man|男|People
おんな|woman|女|People
こども|child|子供|People
おかあさん|mother|お母さん|People
おとうさん|father|お父さん|People
おにいさん|older brother|お兄さん|People
おねえさん|older sister|お姉さん|People
いもうと|younger sister|妹|People
おとうと|younger brother|弟|People
かれ|he; boyfriend|彼|People
かのじょ|she; girlfriend|彼女|People
なかま|comrade, friend (crew)|仲間|Anime
ごはん|cooked rice; meal|ご飯|Food
あさごはん|breakfast|朝ご飯|Food
ひるごはん|lunch|昼ご飯|Food
ばんごはん|dinner|晩ご飯|Food
みず|water|水|Food
おちゃ|tea|お茶|Food
さかな|fish|魚|Food
にく|meat|肉|Food
ぶたにく|pork|豚肉|Food
たまご|egg|卵|Food
やさい|vegetables|野菜|Food
くだもの|fruit|果物|Food
りんご|apple||Food
みかん|mandarin orange||Food
ぎゅうにゅう|milk|牛乳|Food
おにぎり|rice ball||Food
べんとう|boxed lunch|弁当|Food
とうふ|tofu|豆腐|Food
みそしる|miso soup|味噌汁|Food
しょうゆ|soy sauce|醤油|Food
そば|soba noodles (Okinawa soba!)||Food
おいしい|delicious|美味しい|Adjectives
まずい|tastes bad||Adjectives
たべる|to eat|食べる|Verbs
のむ|to drink|飲む|Verbs
うち|home, my house||Places
がっこう|school|学校|Places
みせ|shop|店|Places
びょういん|hospital|病院|Places
ぎんこう|bank|銀行|Places
ゆうびんきょく|post office|郵便局|Places
としょかん|library|図書館|Places
こうえん|park|公園|Places
くうこう|airport|空港|Places
みち|road, street|道|Places
まち|town|町|Places
へや|room|部屋|Places
おてあらい|restroom|お手洗い|Places
かいしゃ|company, office|会社|Places
しごと|work, job|仕事|Places
にほん|Japan|日本|Places
どこ|where?||Places
みぎ|right|右|Places
ひだり|left|左|Places
まえ|front, before|前|Places
うしろ|behind|後ろ|Places
した|below, down|下|Places
なか|inside|中|Places
そと|outside|外|Places
ちかい|near|近い|Adjectives
とおい|far|遠い|Adjectives
きょう|today|今日|Time
あした|tomorrow|明日|Time
きのう|yesterday|昨日|Time
いま|now|今|Time
いつ|when?||Time
ひる|noon, daytime|昼|Time
よる|night|夜|Time
はる|spring|春|Time
なつ|summer|夏|Time
ふゆ|winter|冬|Time
まいにち|every day|毎日|Time
じかん|time, hours|時間|Time
しゅうまつ|weekend|週末|Time
やすみ|day off, break|休み|Time
そら|sky|空|Nature
あめ|rain|雨|Nature
ゆき|snow|雪|Nature
かぜ|wind; a cold|風|Nature
はれ|sunny weather|晴れ|Nature
くも|cloud|雲|Nature
やま|mountain|山|Nature
かわ|river|川|Nature
はな|flower|花|Nature
ほし|star|星|Nature
つき|moon|月|Nature
たいよう|sun|太陽|Nature
ねこ|cat|猫|Animals
いぬ|dog|犬|Animals
とり|bird|鳥|Animals
め|eye|目|Body
みみ|ear|耳|Body
くち|mouth|口|Body
て|hand|手|Body
あたま|head|頭|Body
おなか|stomach, belly|お腹|Body
ほん|book|本|Things
くるま|car|車|Things
でんわ|telephone|電話|Things
かばん|bag||Things
さいふ|wallet|財布|Things
かぎ|key|鍵|Things
おかね|money|お金|Things
くすり|medicine|薬|Things
ふく|clothes|服|Things
くつ|shoes|靴|Things
まど|window|窓|Things
とけい|clock, watch|時計|Things
かみ|paper|紙|Things
でんしゃ|train|電車|Things
じてんしゃ|bicycle|自転車|Things
ひこうき|airplane|飛行機|Things
ふね|boat, ship|船|Things
くる|to come|来る|Verbs
かえる|to go home|帰る|Verbs
みる|to see, to watch|見る|Verbs
はなす|to speak|話す|Verbs
よむ|to read|読む|Verbs
わかる|to understand|分かる|Verbs
する|to do||Verbs
ある|to exist (things)||Verbs
いる|to exist (people, animals)||Verbs
ねる|to sleep|寝る|Verbs
おきる|to wake up|起きる|Verbs
かう|to buy|買う|Verbs
まつ|to wait|待つ|Verbs
あう|to meet|会う|Verbs
あそぶ|to play, to hang out|遊ぶ|Verbs
はたらく|to work|働く|Verbs
およぐ|to swim|泳ぐ|Verbs
すむ|to live (somewhere)|住む|Verbs
わすれる|to forget|忘れる|Verbs
おしえる|to teach|教える|Verbs
べんきょうする|to study|勉強する|Verbs|benkyou suru
まもる|to protect|守る|Anime
たたかう|to fight|戦う|Anime
たすける|to save, to help|助ける|Anime
ちいさい|small|小さい|Adjectives
あたらしい|new|新しい|Adjectives
ふるい|old (things)|古い|Adjectives
たかい|expensive; tall|高い|Adjectives
やすい|cheap|安い|Adjectives
いい|good||Adjectives
わるい|bad|悪い|Adjectives
あつい|hot (weather)|暑い|Adjectives
さむい|cold (weather)|寒い|Adjectives
つめたい|cold (to the touch)|冷たい|Adjectives
たのしい|fun|楽しい|Adjectives
うれしい|happy, glad|嬉しい|Adjectives
かなしい|sad|悲しい|Adjectives
こわい|scary|怖い|Adjectives
いそがしい|busy|忙しい|Adjectives
はやい|early; fast|早い|Adjectives
おそい|late; slow|遅い|Adjectives
むずかしい|difficult|難しい|Adjectives
やさしい|kind, gentle|優しい|Adjectives
つよい|strong|強い|Adjectives
よわい|weak|弱い|Adjectives
げんき|healthy, energetic|元気|Adjectives
きれい|pretty; clean|綺麗|Adjectives
しずか|quiet|静か|Adjectives
ひま|free (not busy)|暇|Adjectives
すごい|amazing!||Anime
かわいい|cute|可愛い|Anime
かっこいい|cool, good-looking||Anime
やった|"Yay! I did it!"||Anime
なに|what?!|何|Anime
ほんとう|really; the truth|本当|Anime
まじ|"Seriously?" (slang)||Anime
だいじょうぶ|okay, all right|大丈夫|Anime
まって|"Wait!"|待って|Anime
はやく|"Hurry!"|早く|Anime
がんばって|"Do your best!"|頑張って|Anime
がんばる|to try hard|頑張る|Anime
ゆめ|dream|夢|Anime
ちから|power, strength|力|Anime
しんぱい|worry|心配|Anime
ばか|idiot|馬鹿|Anime
さすが|"As expected!"||Anime
いくぞ|"Let's go!"|行くぞ|Anime
やめて|"Stop it!"||Anime
たすけて|"Help!"|助けて|Anime
しょうぶ|showdown, match|勝負|Anime
まほう|magic|魔法|Anime
ほんき|for real, serious|本気|Anime
ひみつ|secret|秘密|Anime
ぜったい|absolutely|絶対|Anime
おまえ|you (rough)|お前|Anime
おれ|I, me (rough, male)|俺|Anime
ぼく|I, me (boyish)|僕|Anime
よし|"All right!"||Anime
なるほど|"I see."||Phrases
はい|yes||Phrases
どうぞ|please, go ahead||Phrases
どうも|thanks||Phrases
ちょっと|a little; "Um, excuse me"||Phrases
おねがいします|please (asking)|お願いします|Phrases
いくら|how much?||Phrases
これ|this||Phrases
それ|that||Phrases
あれ|that (over there)||Phrases
なんですか|what is it?|何ですか|Phrases|nan desu ka
わかりません|I don't understand|分かりません|Phrases
もういちど|one more time|もう一度|Phrases|mou ichido
ゆっくり|slowly||Phrases
だいすき|love it, really like|大好き|Feelings
もちろん|of course||Phrases
いち|one|一|Numbers
に|two|二|Numbers
さん|three|三|Numbers
よん|four|四|Numbers
ご|five|五|Numbers
ろく|six|六|Numbers
なな|seven|七|Numbers
はち|eight|八|Numbers
きゅう|nine|九|Numbers
じゅう|ten|十|Numbers
ひゃく|hundred|百|Numbers
せん|thousand|千|Numbers
"""


def parse(cards):
    out = []
    for item in cards.split():
        kana = "".join(c for c in item if ord(c) > 127)
        romaji = "".join(c for c in item if ord(c) <= 127)
        out.append((kana, romaji))
    return out


DECK = [(name, parse(cards)) for name, cards in GROUPS]
KANA_INFO = {k: (r, name) for name, cs in DECK for k, r in cs}
SMALL_TSU = "っ"
SMALL_TSU_GROUP = "T"   # small っ is taught with the T row (つ)


def tokenize(word):
    """Split a word into deck kana (two-char combos first). None if unknown."""
    out, i = [], 0
    while i < len(word):
        if word[i:i + 2] in KANA_INFO:
            out.append(word[i:i + 2])
            i += 2
        elif word[i] in KANA_INFO or word[i] == SMALL_TSU:
            out.append(word[i])
            i += 1
        else:
            return None
    return out


def to_romaji(word):
    toks = tokenize(word) or []
    parts = []
    for n, t in enumerate(toks):
        if t == SMALL_TSU:
            nxt = KANA_INFO[toks[n + 1]][0] if n + 1 < len(toks) else ""
            parts.append("t" if nxt.startswith("ch") else nxt[:1])
        elif t == "ん" and n + 1 < len(toks) and \
                KANA_INFO.get(toks[n + 1], ("x",))[0][0] in "aiueoy":
            parts.append("n'")
        else:
            parts.append(KANA_INFO[t][0])
    return "".join(parts)


def needed_groups(word):
    return {SMALL_TSU_GROUP if t == SMALL_TSU else KANA_INFO[t][1]
            for t in tokenize(word)}


def load_words():
    words = []
    for line in WORDS.strip().splitlines():
        f = line.split("|")
        if tokenize(f[0]) is None:
            continue
        romaji = f[4] if len(f) > 4 and f[4] else to_romaji(f[0])
        words.append({"kana": f[0], "en": f[1], "kanji": f[2], "topic": f[3],
                      "romaji": romaji, "groups": needed_groups(f[0])})
    return words


VOCAB = load_words()
TOPICS = ["All topics"] + sorted({w["topic"] for w in VOCAB})
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", "hiragana-flashcards")
CONFIG_FILE = os.path.join(CONFIG_DIR, "settings.json")

CSS = b"""
.kana { font-size: 150px; font-weight: 600; font-family: "Klee One", "Noto Sans CJK JP", "Noto Sans JP", sans-serif; }
.word { font-size: 64px; font-weight: 600; font-family: "Klee One", "Noto Sans CJK JP", "Noto Sans JP", sans-serif; }
.english { font-size: 36px; }
.romaji { font-size: 40px; font-style: italic; color: #555555; font-family: "Crimson Pro", "DejaVu Serif", "Liberation Serif", serif; }
.meaning { font-size: 24px; }
.hint { color: #888888; font-size: 15px; }
.count { font-size: 15px; }
.dict-kana { font-size: 24px; font-weight: 600; font-family: "Klee One", "Noto Sans CJK JP", "Noto Sans JP", sans-serif; }
.dict-sub { color: #888888; }
.dict-row { padding: 6px 4px; }
"""


def load_settings():
    s = {}
    try:
        with open(CONFIG_FILE) as f:
            s = json.load(f)
    except Exception:
        pass
    names = [g for g, _ in DECK]
    s["groups"] = [n for n in s.get("groups", []) if n in names] or ["Vowels"]
    if s.get("direction") not in ("jp", "en"):
        s["direction"] = "jp"
    if s.get("topic") not in TOPICS:
        s["topic"] = TOPICS[0]
    return s


def save_settings(s):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump(s, f)
    except Exception:
        pass


def readable(word, groups):
    return word["groups"] <= set(groups)


class Flashcards(Gtk.Box):
    """A flashcard deck. get_cards() returns a list of dicts with
    front, front_class, back, back_class and meaning."""

    def __init__(self, get_cards, empty_text, extra=None):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=12,
                         margin=24)
        self.get_cards = get_cards
        self.empty_text = empty_text

        top = Gtk.Box(spacing=8)
        self.count = Gtk.Label(xalign=0)
        self.count.get_style_context().add_class("count")
        top.pack_start(self.count, True, True, 0)
        if extra:
            top.pack_end(extra, False, False, 0)
        self.pack_start(top, False, False, 0)

        card = Gtk.EventBox()
        card.connect("button-press-event", lambda *a: self.reveal())
        inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4,
                        valign=Gtk.Align.CENTER)
        card.add(inner)
        self.front = Gtk.Label(wrap=True, justify=Gtk.Justification.CENTER)
        self.back = Gtk.Label(wrap=True, justify=Gtk.Justification.CENTER)
        self.meaning = Gtk.Label(wrap=True, justify=Gtk.Justification.CENTER)
        self.meaning.get_style_context().add_class("meaning")
        self.hint = Gtk.Label(wrap=True, justify=Gtk.Justification.CENTER)
        self.hint.get_style_context().add_class("hint")
        for w in (self.front, self.back, self.meaning):
            inner.pack_start(w, False, False, 0)
        inner.pack_start(self.hint, False, False, 8)
        self.pack_start(card, True, True, 0)

        self.buttons = Gtk.Box(spacing=12, homogeneous=True)
        self.show_btn = Gtk.Button(label="Show answer  (Space)")
        self.show_btn.connect("clicked", lambda *a: self.reveal())
        self.again_btn = Gtk.Button(label="Again  (1)")
        self.again_btn.connect("clicked", lambda *a: self.answer(False))
        self.got_btn = Gtk.Button(label="Got it  (2)")
        self.got_btn.get_style_context().add_class("suggested-action")
        self.got_btn.connect("clicked", lambda *a: self.answer(True))
        self.restart_btn = Gtk.Button(label="Go again  (Space)")
        self.restart_btn.get_style_context().add_class("suggested-action")
        self.restart_btn.connect("clicked", lambda *a: self.start())
        for b in (self.show_btn, self.again_btn, self.got_btn, self.restart_btn):
            b.set_size_request(-1, 48)
            b.set_no_show_all(True)
            self.buttons.pack_start(b, True, True, 0)
        self.pack_start(self.buttons, False, False, 0)
        self.finished = True
        self.revealed = False

    def _set(self, label, text, cls):
        ctx = label.get_style_context()
        for c in ("kana", "word", "english", "romaji"):
            ctx.remove_class(c)
        if cls:
            ctx.add_class(cls)
        label.set_text(text)

    def start(self):
        cards = self.get_cards()
        random.shuffle(cards)
        # Don't open a new round with the card that ended the last one.
        last = getattr(self, "current", None)
        if last and len(cards) > 1 and cards[0]["front"] == last["front"]:
            cards.append(cards.pop(0))
        self.queue = cards
        self.total = len(cards)
        self.missed = set()
        self.finished = False
        if not cards:
            self.finished = True
            self._set(self.front, "", None)
            self._set(self.back, "", None)
            self.meaning.set_text("")
            self.hint.set_text(self.empty_text)
            self.count.set_text("")
            self.set_buttons()
            return
        self.next_card()

    def next_card(self):
        if not self.queue:
            self.finished = True
            right = self.total - len(self.missed)
            self._set(self.front, "Round done!", "english")
            self._set(self.back, "", None)
            self.meaning.set_text("")
            self.hint.set_text(f"{right} of {self.total} right on the first try")
            self.count.set_text("")
            self.set_buttons(restart=True)
            return
        self.current = self.queue[0]
        self.revealed = False
        self._set(self.front, self.current["front"], self.current["front_class"])
        self._set(self.back, " ", "romaji")
        self.meaning.set_text("")
        self.hint.set_text("Click the card or press Space to flip")
        self.count.set_text(f"{len(self.queue)} left")
        self.set_buttons(show=True)

    def reveal(self):
        if self.finished or self.revealed:
            return
        self.revealed = True
        c = self.current
        self._set(self.back, c["back"], c["back_class"])
        self.meaning.set_text(c.get("meaning", ""))
        self.hint.set_text("Did you know it?")
        self.set_buttons(answer=True)

    def answer(self, knew):
        if self.finished or not self.revealed:
            return
        card = self.queue.pop(0)
        if not knew:
            self.missed.add(card["front"])
            # Bring a missed card back soon, at a random spot (never right
            # away) so the order never settles into a pattern.
            lo = 1 if len(self.queue) > 1 else len(self.queue)
            self.queue.insert(random.randint(lo, max(lo, min(6, len(self.queue)))), card)
        self.next_card()

    def set_buttons(self, show=False, answer=False, restart=False):
        self.show_btn.set_visible(show)
        self.again_btn.set_visible(answer)
        self.got_btn.set_visible(answer)
        self.restart_btn.set_visible(restart)

    def on_key(self, key):
        if key in ("space", "Return", "KP_Enter"):
            if self.finished:
                self.start()
            elif not self.revealed:
                self.reveal()
            else:
                self.answer(True)
            return True
        if key in ("1", "KP_1"):
            self.answer(False)
            return True
        if key in ("2", "KP_2"):
            self.answer(True)
            return True
        return False


class Dictionary(Gtk.Box):
    def __init__(self, app):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8,
                         margin=16)
        self.app = app
        bar = Gtk.Box(spacing=8)
        self.search = Gtk.SearchEntry(
            placeholder_text="Search kana, romaji or English")
        self.search.connect("search-changed", lambda *a: self.refresh())
        bar.pack_start(self.search, True, True, 0)
        self.only = Gtk.CheckButton(label="Only words I can read")
        self.only.connect("toggled", lambda *a: self.refresh())
        bar.pack_start(self.only, False, False, 0)
        self.pack_start(bar, False, False, 0)

        self.status = Gtk.Label(xalign=0)
        self.status.get_style_context().add_class("hint")
        self.pack_start(self.status, False, False, 0)

        self.listbox = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        self.rows = []
        for w in sorted(VOCAB, key=lambda w: w["kana"]):
            row = Gtk.ListBoxRow()
            box = Gtk.Box(spacing=16)
            box.get_style_context().add_class("dict-row")
            left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            k = Gtk.Label(label=w["kana"], xalign=0)
            k.get_style_context().add_class("dict-kana")
            sub = Gtk.Label(xalign=0)
            sub.get_style_context().add_class("dict-sub")
            left.pack_start(k, False, False, 0)
            left.pack_start(sub, False, False, 0)
            left.set_size_request(220, -1)
            box.pack_start(left, False, False, 0)
            right = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            en = Gtk.Label(label=w["en"], xalign=0, wrap=True)
            tag = Gtk.Label(xalign=0)
            tag.get_style_context().add_class("dict-sub")
            right.pack_start(en, False, False, 0)
            right.pack_start(tag, False, False, 0)
            box.pack_start(right, True, True, 0)
            row.add(box)
            self.listbox.add(row)
            row.word, row.sub, row.tag = w, sub, tag
            self.rows.append(row)
        self.listbox.set_filter_func(self.visible)
        scroll = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER)
        scroll.add(self.listbox)
        self.pack_start(scroll, True, True, 0)

    def visible(self, row):
        w = row.word
        if self.only.get_active() and not readable(w, self.app.settings["groups"]):
            return False
        q = self.search.get_text().strip().lower()
        if not q:
            return True
        flat = q.replace(" ", "").replace("'", "").replace("-", "")
        rom = w["romaji"].replace(" ", "").replace("'", "").replace("-", "")
        return (q in w["kana"] or q in w["kanji"] or flat in rom
                or q in w["en"].lower())

    def refresh(self):
        groups = self.app.settings["groups"]
        for row in self.rows:
            w = row.word
            row.sub.set_text(w["romaji"] + (f"   {w['kanji']}" if w["kanji"] else ""))
            ok = readable(w, groups)
            row.tag.set_text(w["topic"] + ("  ·  ✓ you can read this" if ok else ""))
        self.listbox.invalidate_filter()
        shown = sum(1 for r in self.rows if self.visible(r))
        can = sum(1 for w in VOCAB if readable(w, groups))
        self.status.set_text(f"{shown} words shown  ·  you can read {can} of "
                             f"{len(VOCAB)} with your study set")


def ensure_font():
    """Download the textbook kana font if it isn't there. It takes effect the
    next time the app starts. Never raises."""
    try:
        if os.path.exists(FONT_FILE):
            return
        os.makedirs(FONT_DIR, exist_ok=True)
        with urllib.request.urlopen(FONT_URL, timeout=60) as r:
            data = r.read()
        if not data.startswith(b"\x00\x01\x00\x00"):   # not a TrueType font
            return
        tmp = FONT_FILE + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, FONT_FILE)
        os.system("fc-cache -f '%s' >/dev/null 2>&1" % FONT_DIR)
    except Exception:
        pass


def fetch_update():
    """Return the newer app source from GitHub, or None (offline, same
    version, or anything odd). Never raises."""
    try:
        with urllib.request.urlopen(UPDATE_URL, timeout=8) as r:
            src = r.read().decode("utf-8")
        m = re.search(r"^APP_VERSION = (\d+)", src, re.M)
        if not m or int(m.group(1)) <= APP_VERSION:
            return None
        compile(src, "hiragana.py", "exec")   # refuse a broken download
        return src
    except Exception:
        return None


class App(Gtk.ApplicationWindow):
    def __init__(self, application):
        super().__init__(application=application, title="Hiragana Flashcards")
        self.set_default_size(600, 560)
        self.set_icon_name("accessories-dictionary")
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.settings = load_settings()

        self.stack = Gtk.Stack()
        header = Gtk.HeaderBar(show_close_button=True)
        header.set_custom_title(Gtk.StackSwitcher(stack=self.stack))
        set_btn = Gtk.Button(label="Study set")
        set_btn.set_tooltip_text("Pick which kana rows you are studying")
        set_btn.connect("clicked", self.choose_set)
        header.pack_start(set_btn)
        self.update_btn = Gtk.Button(label="Update ready")
        self.update_btn.get_style_context().add_class("suggested-action")
        self.update_btn.set_tooltip_text("A newer version is available. "
                                         "Click to install and restart.")
        self.update_btn.set_no_show_all(True)
        self.update_btn.connect("clicked", self.install_update)
        header.pack_end(self.update_btn)
        self.set_titlebar(header)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        if WebKit2 is None:
            # The tutor window needs WebKitGTK; say how to get it.
            bar = Gtk.InfoBar(message_type=Gtk.MessageType.INFO)
            msg = Gtk.Label(xalign=0, selectable=True, wrap=True)
            msg.set_markup("To get the Claude tutor in this app, install WebKitGTK once, "
                           "then reopen:\n<tt>sudo apt install gir1.2-webkit2-4.1</tt>")
            bar.get_content_area().add(msg)
            box.pack_start(bar, False, False, 0)
        box.pack_start(self.stack, True, True, 0)
        self.add(box)

        self.kana_page = Flashcards(self.kana_cards, "Pick a study set.")

        opts = Gtk.Box(spacing=8)
        self.topic = Gtk.ComboBoxText()
        for t in TOPICS:
            self.topic.append(t, t)
        self.topic.set_active_id(self.settings["topic"])
        self.topic.connect("changed", self.vocab_option_changed)
        self.direction = Gtk.ComboBoxText()
        self.direction.append("jp", "Japanese → English")
        self.direction.append("en", "English → Japanese")
        self.direction.set_active_id(self.settings["direction"])
        self.direction.connect("changed", self.vocab_option_changed)
        for w in (self.topic, self.direction):
            w.set_can_focus(False)
            opts.pack_start(w, False, False, 0)
        self.vocab_page = Flashcards(
            self.vocab_cards,
            "No words yet use only the kana in your study set.\n"
            "Add a row with “Study set”, or pick another topic.", extra=opts)
        self.dict_page = Dictionary(self)

        self.stack.add_titled(self.kana_page, "kana", "Kana")
        self.stack.add_titled(self.vocab_page, "vocab", "Vocab")
        self.stack.add_titled(self.dict_page, "dict", "Dictionary")

        self.connect("key-press-event", self.on_key)
        self.show_all()
        self.refresh_all()
        self.new_source = None
        threading.Thread(target=self.check_update, daemon=True).start()

    # ----- updates -----
    def check_update(self):
        ensure_font()
        src = fetch_update()
        if src:
            GLib.idle_add(self.offer_update, src)

    def offer_update(self, src):
        self.new_source = src
        self.update_btn.show()
        return False

    def install_update(self, _btn):
        path = os.path.abspath(__file__)
        try:
            tmp = path + ".new"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(self.new_source)
            os.chmod(tmp, 0o755)
            os.replace(tmp, path)
        except Exception as e:
            self.update_btn.set_label("Update failed")
            self.update_btn.set_tooltip_text(str(e))
            return
        # Quit first so this copy lets go of the single-instance lock, then
        # start the new version once we are out of the main loop.
        self.get_application().restart = path
        self.get_application().quit()

    # ----- card sources -----
    def kana_cards(self):
        return [{"front": k, "front_class": "kana",
                 "back": ("*" + r) if r in IRREGULAR else r,
                 "back_class": "romaji"}
                for name, cs in DECK if name in self.settings["groups"]
                for k, r in cs]

    def vocab_cards(self):
        topic = self.settings["topic"]
        words = [w for w in VOCAB if readable(w, self.settings["groups"])
                 and topic in (TOPICS[0], w["topic"])]
        cards = []
        for w in words:
            kanji = f"   ({w['kanji']})" if w["kanji"] else ""
            if self.settings["direction"] == "en":
                cards.append({"front": w["en"], "front_class": "english",
                              "back": w["kana"], "back_class": "word",
                              "meaning": w["romaji"] + kanji})
            else:
                cards.append({"front": w["kana"], "front_class": "word",
                              "back": w["romaji"], "back_class": "romaji",
                              "meaning": w["en"] + kanji})
        return cards

    def vocab_option_changed(self, _w):
        self.settings["topic"] = self.topic.get_active_id()
        self.settings["direction"] = self.direction.get_active_id()
        save_settings(self.settings)
        self.vocab_page.start()

    def refresh_all(self):
        self.kana_page.start()
        self.vocab_page.start()
        self.dict_page.refresh()

    def on_key(self, _w, event):
        page = self.stack.get_visible_child()
        if isinstance(page, Flashcards):
            return page.on_key(Gdk.keyval_name(event.keyval))
        return False

    # ----- study set picker -----
    def choose_set(self, _btn):
        dlg = Gtk.Dialog(title="Study set", transient_for=self, modal=True)
        dlg.add_buttons("Cancel", Gtk.ResponseType.CANCEL,
                        "Study these", Gtk.ResponseType.OK)
        dlg.set_default_response(Gtk.ResponseType.OK)
        area = dlg.get_content_area()
        area.set_spacing(8)
        area.set_border_width(16)

        quick = Gtk.Box(spacing=8)
        checks = {}

        def pick(names):
            for n, c in checks.items():
                c.set_active(n in names)

        names = [n for n, _ in DECK]
        for label, chosen in (("Basic 46", names[:10]),
                              ("Dakuten", names[10:15]),
                              ("Combos", names[15:]),
                              ("All", names), ("None", [])):
            b = Gtk.Button(label=label)
            b.connect("clicked", lambda _b, c=chosen: pick(c))
            quick.pack_start(b, False, False, 0)
        area.pack_start(quick, False, False, 0)

        grid = Gtk.Grid(column_spacing=24, row_spacing=4)
        for i, (name, cards) in enumerate(DECK):
            preview = " ".join(k for k, _ in cards[:5])
            c = Gtk.CheckButton(label=f"{name}   {preview}")
            c.set_active(name in self.settings["groups"])
            checks[name] = c
            grid.attach(c, i // 9, i % 9, 1, 1)
        area.pack_start(grid, False, False, 0)

        info = Gtk.Label(label="")
        info.get_style_context().add_class("hint")
        area.pack_start(info, False, False, 0)

        def update_info(*_a):
            sel = [n for n, c in checks.items() if c.get_active()]
            can = sum(1 for w in VOCAB if readable(w, sel))
            info.set_text(f"With these rows you can read {can} vocab words."
                          if sel else "Pick at least one row.")
        for c in checks.values():
            c.connect("toggled", update_info)
        update_info()
        dlg.show_all()

        while True:
            resp = dlg.run()
            if resp != Gtk.ResponseType.OK:
                break
            sel = [n for n, c in checks.items() if c.get_active()]
            if not sel:
                continue
            self.settings["groups"] = sel
            save_settings(self.settings)
            self.refresh_all()
            break
        dlg.destroy()


# ---------------------------------------------------------------- tutor app
def sync_app_files(force=False):
    """Download the tutor UI and voice helper from GitHub when this version's
    copy isn't there yet. Returns True if the files are in place."""
    try:
        if not force and open(STAMP).read().strip() == str(APP_VERSION) \
                and os.path.exists(os.path.join(TUTOR_APP, "index.html")):
            return True
    except OSError:
        pass
    try:
        with urllib.request.urlopen(REPO_TARBALL, timeout=60) as r:
            data = r.read()
        tmp = TUTOR_HOME + ".new"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
            for m in tar.getmembers():
                parts = m.name.split("/", 1)
                if len(parts) < 2 or not (parts[1].startswith("docs/") or parts[1].startswith("voice-helper/")):
                    continue
                if not (m.isfile() or m.isdir()) or ".." in parts[1].split("/"):
                    continue
                m.name = parts[1].replace("docs/", "app/", 1)
                tar.extract(m, tmp)
        os.makedirs(TUTOR_HOME, exist_ok=True)
        for sub in ("app", "voice-helper"):
            src, dst = os.path.join(tmp, sub), os.path.join(TUTOR_HOME, sub)
            if os.path.isdir(src):
                shutil.rmtree(dst + ".old", ignore_errors=True)
                if os.path.exists(dst):
                    os.rename(dst, dst + ".old")
                os.rename(src, dst)
                shutil.rmtree(dst + ".old", ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)
        with open(STAMP, "w") as f:
            f.write(str(APP_VERSION))
        return True
    except Exception as e:
        print("Couldn't update tutor files:", e, file=sys.stderr)
        return os.path.exists(os.path.join(TUTOR_APP, "index.html"))


def helper_up():
    try:
        with urllib.request.urlopen(HELPER_URL + "/health", timeout=1) as r:
            return r.status == 200
    except Exception:
        return False


def helper_version():
    try:
        with urllib.request.urlopen(HELPER_URL + "/health", timeout=2) as r:
            return int(json.loads(r.read()).get("version", 0))
    except Exception:
        return None


def stop_helper():
    """Stop a helper left running from before (e.g. an older version after an
    update), so the new code is the one that runs."""
    try:
        req = urllib.request.Request(HELPER_URL + "/quit", method="POST")
        urllib.request.urlopen(req, timeout=2).read()
    except Exception:
        pass
    for _ in range(20):
        if not helper_up():
            return
        time.sleep(0.1)
    # Older helpers have no /quit.
    subprocess.run(["pkill", "-f", "voice-helper/jp_voice.py"], check=False)
    for _ in range(30):
        if not helper_up():
            return
        time.sleep(0.1)


def start_helper():
    """Start the local helper. Uses the voice environment if it's installed,
    otherwise plain python3 (the tutor works, voice input stays off)."""
    py = HELPER_PY if os.path.exists(HELPER_PY) else "/usr/bin/python3"
    script = os.path.join(HELPER_DIR, "jp_voice.py")
    logf = open(os.path.join(TUTOR_HOME, "voice-helper.log"), "a")
    return subprocess.Popen([py, script], stdout=logf, stderr=subprocess.STDOUT,
                            start_new_session=True)


LOADING_HTML = """<html><body style="font-family:sans-serif;display:flex;
align-items:center;justify-content:center;height:90vh;color:#666">
<div style="text-align:center"><div style="font-size:64px">あ</div>%s</div></body></html>"""


class TutorWindow(Gtk.ApplicationWindow):
    def __init__(self, application):
        super().__init__(application=application, title="Japanese Tutor")
        self.set_default_size(1000, 760)
        self.set_icon_name("accessories-dictionary")
        self.helper = None
        self.new_source = None

        header = Gtk.HeaderBar(show_close_button=True, title="Japanese Tutor")
        self.update_btn = Gtk.Button(label="Update ready")
        self.update_btn.get_style_context().add_class("suggested-action")
        self.update_btn.set_no_show_all(True)
        self.update_btn.connect("clicked", self.install_update)
        header.pack_end(self.update_btn)
        self.set_titlebar(header)

        data_dir = os.path.join(TUTOR_HOME, "webdata")
        manager = WebKit2.WebsiteDataManager(
            base_data_directory=os.path.join(data_dir, "data"),
            base_cache_directory=os.path.join(data_dir, "cache"))
        ctx = WebKit2.WebContext.new_with_website_data_manager(manager)
        ctx.connect("download-started", self.on_download)
        self.view = WebKit2.WebView.new_with_context(ctx)
        st = self.view.get_settings()
        st.set_property("media-playback-requires-user-gesture", False)
        st.set_property("enable-developer-extras", False)
        st.set_property("javascript-can-access-clipboard", True)
        self.view.connect("decide-policy", self.on_policy)
        self.view.load_html(LOADING_HTML % "Starting…", "about:blank")
        self.add(self.view)
        self.connect("destroy", self.on_destroy)
        self.show_all()
        threading.Thread(target=self.boot, daemon=True).start()

    def boot(self):
        if not sync_app_files():
            GLib.idle_add(self.view.load_html, LOADING_HTML %
                          "Couldn't download the tutor. Check your internet connection and reopen the app.",
                          "about:blank")
            return
        v = helper_version()
        if v is not None and v < HELPER_VERSION:
            stop_helper()
        if not helper_up():
            self.helper = start_helper()
            for _ in range(100):
                if helper_up():
                    break
                time.sleep(0.1)
        GLib.idle_add(self.view.load_uri, HELPER_URL + "/")
        src = fetch_update()
        if src:
            GLib.idle_add(self.offer_update, src)

    def on_policy(self, view, decision, kind):
        # Open outside links (e.g. console.anthropic.com) in the default browser.
        if kind in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
                    WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            uri = decision.get_navigation_action().get_request().get_uri()
            if uri.startswith("http") and not uri.startswith(HELPER_URL):
                Gtk.show_uri_on_window(self, uri, Gdk.CURRENT_TIME)
                decision.ignore()
                return True
        return False

    def on_download(self, _ctx, download):
        def decide(dl, suggested):
            folder = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) \
                or os.path.expanduser("~")
            dl.set_destination("file://" + os.path.join(folder, suggested or "download"))
            return True
        download.connect("decide-destination", decide)

    def offer_update(self, src):
        self.new_source = src
        self.update_btn.show()
        return False

    def install_update(self, _btn):
        # Stop the voice helper too, so the updated one starts with the new app.
        self.on_destroy()
        App.install_update(self, _btn)

    def on_destroy(self, *_a):
        if self.helper and self.helper.poll() is None:
            self.helper.terminate()


class Main(Gtk.Application):
    """Only one copy runs at a time: launching again just brings the open
    window to the front."""

    def __init__(self):
        super().__init__(application_id=APP_ID)
        self.window = None
        self.restart = None

    def do_activate(self):
        if self.window is None:
            self.window = TutorWindow(self) if WebKit2 else App(self)
        self.window.present()


if __name__ == "__main__":
    app = Main()
    app.run(None)
    if app.restart:
        os.execv(sys.executable, [sys.executable, app.restart])
